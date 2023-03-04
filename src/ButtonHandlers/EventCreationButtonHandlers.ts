import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GuildScheduledEvent,
  PermissionsBitField,
  TextInputModalData,
  ThreadChannel,
} from "discord.js";
import editEventMessage from "../Content/Embed/editEventMessage";
import { getEventDetailsMessage } from "../Content/Embed/eventEmbed";
import { editRecurrence } from "../Content/Modal/editRecurrence";
import { eventModal } from "../Content/Modal/eventModal";
import EventCreators from "../EventCreators";
import { EventMonkeyEvent } from "../EventMonkeyEvent";
import EventsUnderConstruction from "../EventsUnderConstruction";
import Listeners from "../Listeners";
import Threads from "../Utility/Threads";
import Time from "../Utility/Time";
import { MessageCreateOptions } from 'discord.js';

const eventCreationButtonHandlers: {
  [handlerName: string]: (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    originalInteraction: ChatInputCommandInteraction,
    client: Client
  ) => void;
} = {
  edit: async (event, submissionInteraction, originalInteraction, client) => {
    await eventModal(event, submissionInteraction, originalInteraction);
  },
  makeRecurring: async (
    event,
    submissionInteraction,
    originalInteraction,
    client
  ) => {
    if (!submissionInteraction.guild) return;

    event.recurrence = {
      firstStartTime: event.scheduledStartTime,
      timesHeld: 0,
      weeks: 1,
    };

    const recurrenceModal = editRecurrence(event, submissionInteraction);
    await submissionInteraction.showModal(recurrenceModal);
    var submission = await submissionInteraction.awaitModalSubmit({
      time: Time.toMilliseconds.minutes(5),
      filter: (submitInteraction, collected) =>
        submitInteraction.user.id === event.author.id &&
        submitInteraction.customId === recurrenceModal.data.custom_id,
    });

    await submission.deferUpdate();
    var unitField = submission.fields.getField(
      `${event.id}_unit`
    ) as TextInputModalData;
    let unit = unitField.value;

    if (!unit.endsWith("s")) unit += "s";
    if (
      unit !== "hours" &&
      unit !== "days" &&
      unit !== "weeks" &&
      unit !== "months"
    ) {
      await submission.reply({
        content: `Invalid time unit. Valid options are "hours", "days", "weeks", or "months"`,
        ephemeral: true,
      });
      return;
    }

    const frequencyField = submission.fields.getField(
      `${event.id}_frequency`
    ) as TextInputModalData;
    if (frequencyField.value.match(/[^\d]/)) {
      await submission.reply({
        content: `Frequency must be a whole number.`,
        ephemeral: true,
      });
      return;
    }

    const frequency = Number(frequencyField.value);
    if (isNaN(frequency)) {
      await submission.reply({
        content: `The time before the next recurrence must be a number.`,
        ephemeral: true,
      });
      return;
    }

    const recurrence: any = {
      firstStartTime: event.scheduledStartTime,
      timesHeld: 0,
    };

    recurrence[unit] = frequency;

    event.recurrence = recurrence;
    const submissionEmbed = await editEventMessage(
      event,
      `Event will recur every ${frequency} ${unit}`,
      originalInteraction
    );
    await originalInteraction.editReply(submissionEmbed);
  },
  addImage: async (
    event,
    submissionInteraction,
    originalInteraction,
    client
  ) => {
    await originalInteraction.editReply({
      content: "Adding image. Please be patient! If your image is large, this may take a minute.",
      embeds: [],
      components: [],
    });

    const imageResponse = await submissionInteraction.reply({
      content: `Hi ${submissionInteraction.user.toString()}, just reply to this message with your image!`,
      fetchReply: true,
    });

    if (!("awaitMessages" in imageResponse.channel)) return;

    let replies = await imageResponse.channel.awaitMessages({
      filter: (replyInteraction) =>
        replyInteraction.reference?.messageId === imageResponse.id &&
        replyInteraction.author.id === originalInteraction.user.id,
      time: Time.toMilliseconds.minutes(10),
      max: 1,
    });

    if (!replies.at(0)) {
      imageResponse.edit("Sorry, you took too long! Please try again.");
      setTimeout(() => imageResponse.delete(), Time.toMilliseconds.minutes(1));
      const submissionEmbed = await editEventMessage(
        event,
        "",
        originalInteraction
      );
      await originalInteraction.editReply(submissionEmbed);
      return;
    }

    await originalInteraction.editReply({
      content: "Adding image...",
      embeds: [],
      components: [],
    });

    let submissionEmbed: MessageCreateOptions;
    if (replies.at(0)?.attachments.at(0)?.url) {
      event.image = replies.at(0)?.attachments.at(0)?.url as string;
      submissionEmbed = await editEventMessage(
        event,
        "Image added!",
        originalInteraction
      );
      await replies.at(0)?.delete();
      await imageResponse.delete();
    } else {
      submissionEmbed = await editEventMessage(
        event,
        "Your message didn't have a valid image attached!",
        originalInteraction
      );
    }

    await originalInteraction.editReply(submissionEmbed);
  },
  save: async (event, submissionInteraction, originalInteraction, client) => {
    await originalInteraction.editReply({
      content: `Saved for later! You can continue from where you left off. Don't wait too long, or you will have to start over again!`,
      embeds: [],
      components: [],
    });
    EventsUnderConstruction.saveEvent(event);
    Listeners.getEmbedSubmissionCollector(event, originalInteraction)?.stop();
  },
  finish: async (event, submissionInteraction, originalInteraction, client) => {
    if (!submissionInteraction.message.guild) return;
    await submissionInteraction.deferUpdate();

    if (
      event.scheduledStartTime.valueOf() - Date.now() <
      Time.toMilliseconds.minutes(30)
    ) {
      const member = await submissionInteraction.message.guild.members.fetch(
        event.author.id
      );
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await submissionInteraction.update({
          content:
            "Sorry, your start time needs to be more than 30 minutes from now!",
        });

        return;
      }
    }

    if (!event.attendees.includes(submissionInteraction.user.id))
      event.attendees.push(submissionInteraction.user.id);

    await originalInteraction.editReply({
      content: "Creating event...",
      embeds: [],
      components: [],
    });

    const forumThread = await EventCreators.createThreadChannelEvent(
      event,
      submissionInteraction.message.guild
    );

    try {
      const guildScheduledEvent = await EventCreators.createGuildScheduledEvent(
        event,
        submissionInteraction.message.guild,
        forumThread
      );

      if (guildScheduledEvent) {
        await updateScheduledEventUrl(guildScheduledEvent, forumThread);
      }
    } catch (error) {
      console.error(error);
      console.error(event);
      await originalInteraction.editReply({
        content: `Sorry, something went wrong!`,
        embeds: [],
        components: [],
      });

      if (forumThread) await forumThread.delete();
      
      EventsUnderConstruction.saveEvent(event);
      return;
    } finally {
      Listeners.getEmbedSubmissionCollector(event, originalInteraction)?.stop();
    }

    await originalInteraction.editReply({
      content: "Event created successfully!",
      embeds: [],
      components: [],
    });

    EventsUnderConstruction.deleteEvent(submissionInteraction.user.id);
  },
  cancel: async (event, submissionInteraction, originalInteraction, client) => {
    const submissionMessage = submissionInteraction.message;
    if (event.threadChannel) {
      const yesNoButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("CANCEL EVENT")
          .setStyle(ButtonStyle.Danger)
          .setCustomId(`${submissionInteraction.id}_cancelEvent`),
        new ButtonBuilder()
          .setLabel("Cancel Editing")
          .setStyle(ButtonStyle.Success)
          .setCustomId(`${submissionInteraction.id}_cancelEdit`)
      );
      const response = await submissionInteraction.reply({
        content:
          "Do you want to cancel your existing event, or just cancel editing?",
        ephemeral: true,
        components: [yesNoButtons],
      });
      let collected;
      try {
        collected = await response.awaitMessageComponent({
          filter: (interaction) =>
            interaction.customId.startsWith(`${submissionInteraction.id}_`),
          time: Time.toMilliseconds.minutes(1),
        });
      } catch {}
      if (!collected) {
        await submissionInteraction.editReply({
          content: "Sorry, your response timed out!",
        });
        return;
      }

      await collected.deferUpdate();
      await submissionInteraction.deleteReply();
      if (collected.customId.endsWith(`_cancelEvent`)) {
        await originalInteraction.editReply({
          content: "Cancelled event.",
          embeds: [],
          components: [],
        });

        if (event.threadChannel && event.scheduledEvent) {
          await Threads.closeEventThread(
            event.threadChannel,
            event.scheduledEvent
          );
        }

        if (event.scheduledEvent) {
          await event.scheduledEvent.delete();
        }
      }
    }

    await originalInteraction.editReply({
      content: "Cancelled event creation.",
      embeds: [],
      components: [],
    });

    EventsUnderConstruction.deleteEvent(submissionInteraction.user.id);
    Listeners.getEmbedSubmissionCollector(event, originalInteraction)?.stop();
  },
};

export async function updateScheduledEventUrl(
  guildScheduledEvent: GuildScheduledEvent,
  thread: ThreadChannel
) {
  const eventMessage = await getEventDetailsMessage(thread);
  if (eventMessage) {
    const embeds: any[] = [...eventMessage.embeds];
    embeds[0] = new EmbedBuilder(embeds[0].data).setURL(
      guildScheduledEvent.url
    );
    await eventMessage.edit({ embeds });
  }
}

export default eventCreationButtonHandlers;
