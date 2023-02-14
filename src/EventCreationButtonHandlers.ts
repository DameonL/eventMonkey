import {
  ButtonInteraction,
  Client,
  GuildScheduledEvent,
  ModalSubmitInteraction,
  PermissionsBitField,
  TextInputModalData,
  ThreadChannel,
} from "discord.js";
import { createSubmissionEmbed, recurrenceModal } from "./ContentCreators";
import {
  createForumChannelEvent,
  createGuildScheduledEvent,
} from "./EventCreators";
import {
  deleteEvent,
  getEmbedSubmissionCollector,
  saveEvent,
  showEventModal,
} from "./EventMonkey";
import { EventMonkeyEvent } from "./EventMonkeyEvent";
import { closeEventThread } from "./ThreadUtilities";
import { minutes } from "./TimeConversion";

const eventCreationButtonHandlers: {
  [handlerName: string]: (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => void;
} = {
  edit: async (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => {
    await modalSubmission.deleteReply();
    await showEventModal(event, submissionInteraction);
  },
  makeRecurring: async (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => {
    event.recurrence = {
      firstStartTime: event.scheduledStartTime,
      timesHeld: 0,
      weeks: 1,
    };
    await submissionInteraction.showModal(recurrenceModal(event));
    var submission = await submissionInteraction.awaitModalSubmit({
      time: minutes(5),
      filter: (submitInteraction, collected) => {
        if (
          submitInteraction.user.id === modalSubmission.user.id &&
          submitInteraction.customId === event.id
        ) {
          return true;
        }

        return false;
      },
    });
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
    await submission.reply({
      content: `Event will recur every ${frequency} ${unit}`,
      ephemeral: true,
    });
    const submissionEmbed = createSubmissionEmbed(
      event,
      "Image added!",
      client?.user?.id ?? ""
    );
    await modalSubmission.editReply(submissionEmbed);
},
  addImage: async (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => {
    await modalSubmission.editReply({
      content: "Adding image...",
      embeds: [],
      components: [],
    });

    const imageResponse = await submissionInteraction.reply({
      content: `Hi ${submissionInteraction.user.toString()}, just reply to this message with your image!`,
      fetchReply: true,
    });

    let replies = await imageResponse.channel.awaitMessages({
      filter: (replyInteraction) =>
        replyInteraction.reference?.messageId === imageResponse.id,
      time: minutes(10),
      max: 1,
    });

    if (!replies.at(0)) {
      imageResponse.edit("Sorry, you took too long! Please try again.");
      setTimeout(() => imageResponse.delete(), minutes(1));
      const submissionEmbed = createSubmissionEmbed(
        event,
        "",
        client?.user?.id ?? ""
      );
      await modalSubmission.editReply(submissionEmbed);
      return;
    }

    if (replies.at(0)?.attachments.at(0)?.url) {
      event.image = replies.at(0)?.attachments.at(0)?.url as string;
      await replies.at(0)?.delete();
      await imageResponse.delete();
      const submissionEmbed = createSubmissionEmbed(
        event,
        "Image added!",
        client?.user?.id ?? ""
      );
      await modalSubmission.editReply(submissionEmbed);
    }
  },
  save: async (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => {
    await submissionInteraction.update({
      content: `Saved for later! You can continue from where you left off with "/meetup create". Don't wait too long, or you will have to start over again!`,
      embeds: [],
      components: [],
    });
    saveEvent(event);
    getEmbedSubmissionCollector(event, modalSubmission)?.stop();
  },
  finish: async (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => {
    if (!modalSubmission.guild) return;

    if (!submissionInteraction.deferred) submissionInteraction.deferUpdate();

    if (
      event.scheduledStartTime.valueOf() - new Date().valueOf() <
      minutes(30)
    ) {
      const permissions = modalSubmission.member?.permissions as Readonly<PermissionsBitField>;
      if (!permissions.has(PermissionsBitField.Flags.Administrator)) {
        await modalSubmission.editReply({
          content:
            "Sorry, your start time needs to be more than 30 minutes from now!",
        });
  
        return;
      }
    }

    await modalSubmission.editReply({
      content: "Creating event...",
      embeds: [],
      components: [],
    });

    const forumThread = await createForumChannelEvent(
      event,
      modalSubmission.guild,
      client
    );

    try {
      const guildScheduledEvent = await createGuildScheduledEvent(
        event,
        modalSubmission.guild,
        forumThread.toString()
      );

      if (guildScheduledEvent) {
        await updateScheduledEventUrl(guildScheduledEvent, forumThread);
      }
    } catch (error) {
      console.error(error);
      console.log(event);
      await modalSubmission.editReply({
        content: `Sorry, something went wrong!`,
        embeds: [],
        components: [],
      });

      saveEvent(event);
    } finally {
      getEmbedSubmissionCollector(event, modalSubmission)?.stop();
    }

    await modalSubmission.editReply({
      content: "Event created successfully!",
      embeds: [],
      components: [],
    });

    deleteEvent(submissionInteraction.user.id);
  },
  cancel: async (
    event: EventMonkeyEvent,
    submissionInteraction: ButtonInteraction,
    modalSubmission: ModalSubmitInteraction,
    client: Client
  ) => {
    await modalSubmission.editReply({
      content: "Cancelled event creation.",
      embeds: [],
      components: [],
    });

    if (event.threadChannel && event.scheduledEvent) {
      await closeEventThread(event.threadChannel, event.scheduledEvent);
    }

    if (event.scheduledEvent) {
      await event.scheduledEvent.delete();
    }

    deleteEvent(submissionInteraction.user.id);
    getEmbedSubmissionCollector(event, modalSubmission)?.stop();
  },
};

export default eventCreationButtonHandlers;
async function updateScheduledEventUrl(
  guildScheduledEvent: GuildScheduledEvent,
  forumThread: ThreadChannel
) {
  const eventMessage = forumThread.messages.cache.at(0);
  if (eventMessage) {
    const embeds = [...eventMessage.embeds];
    let embedField = embeds[0].fields.find((x) => x.name === "Event Link");
    if (!embedField) {
      embedField = { name: "Event Link", value: guildScheduledEvent.url };
      embeds[0].fields.push(embedField);
    } else {
      embedField.value = guildScheduledEvent.url;
    }

    await eventMessage.edit({ embeds });
  }
}
