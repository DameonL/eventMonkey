import {
  ButtonInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  GuildScheduledEventEntityType,
  ModalBuilder,
  TextInputStyle,
} from "discord.js";
import {
  configuration,
  EventMonkeyEvent,
} from "../../EventMonkey";
import { saveEvent } from "../../EventsUnderConstruction";
import { getEmbedSubmissionCollector } from "../../Listeners";
import { getTimeString } from "../../Serialization";
import submission from "../Embed/submission";
import {
  deserializeModal,
  ModalDeserializationConfig,
  ModalSerializationConfig,
  serializeToModal,
} from "./SerializedModal";

export async function eventModal(
  event: EventMonkeyEvent,
  interactionToReply: ChatInputCommandInteraction | ButtonInteraction
) {
  const modal = eventEditModal(event);

  await interactionToReply.showModal(modal);
  const modalSubmission = await interactionToReply.awaitModalSubmit({
    time: configuration.editingTimeout,
    filter: (submitInteraction, collected) => {
      if (
        submitInteraction.user.id === interactionToReply.user.id &&
        submitInteraction.customId === event.id
      ) {
        return true;
      }

      return false;
    },
  });

  const deserializationConfig: ModalDeserializationConfig = {
    validators: {
      scheduledStartTime: (fieldValue: string) =>
        /\d\d?\/\d\d?\/\d{2,4}\s+\d\d?:\d\d\s+(am|pm)/i.test(fieldValue)
          ? undefined
          : "Invalid date format.",
      duration: (fieldValue: string) =>
        isNaN(Number(fieldValue)) ? "Invalid duration" : undefined,
    },
    customDeserializers: {
      scheduledStartTime: (fieldValue: string) =>
        new Date(Date.parse(fieldValue)),
      duration: (fieldValue: string) => Number(fieldValue),
    },
  };

  try {
    deserializeModal<EventMonkeyEvent>(
      modalSubmission.fields.fields.entries(),
      event,
      deserializationConfig
    );
  } catch (error: any) {
    await modalSubmission.reply({
      content: error.toString(),
      ephemeral: true,
    });

    saveEvent(event);
    return;
  }

  if (event.entityType !== GuildScheduledEventEntityType.External) {
    let matchingChannel = modalSubmission.guild?.channels.cache.find(
      (x) =>
        x.name.toLowerCase() === event.entityMetadata.location.toLowerCase()
    );
    if (!matchingChannel) {
      await modalSubmission.reply({
        content: `Couldn't find a channel named "${event.entityMetadata.location}".`,
        ephemeral: true,
      });

      saveEvent(event);
      return;
    }
    if (
      matchingChannel.type !== ChannelType.GuildVoice &&
      matchingChannel.type !== ChannelType.GuildStageVoice
    ) {
      await modalSubmission.reply({
        content: `The channel must be a Voice or Stage channel.`,
        ephemeral: true,
      });

      saveEvent(event);
      return;
    }

    event.channel = matchingChannel;
    event.entityMetadata.location = matchingChannel.url;
  }

  let submissionEmbed = submission(
    event,
    "",
    configuration.discordClient?.user?.id ?? ""
  );
  await modalSubmission.reply(submissionEmbed);
  event.submissionCollector?.stop();
  event.submissionCollector = undefined;
  event.submissionCollector = getEmbedSubmissionCollector(
    event,
    modalSubmission
  );
}

export function eventEditModal(event: EventMonkeyEvent) {
  const modal = new ModalBuilder();
  modal.setTitle("Create a New Meetup");
  modal.setCustomId(event.id);

  const serializationObject = {
    name: event.name,
    description: event.description,
    "entityMetadata.location": event.entityMetadata.location,
    scheduledStartTime: event.scheduledStartTime,
    duration: event.duration,
  };
  const serializationConfig: ModalSerializationConfig = {
    labels: {
      "entityMetadata.location":
        event.entityType === GuildScheduledEventEntityType.External
          ? "Location"
          : "Channel",
      scheduledStartTime: "Scheduled Start Time",
    },
    formatters: {
      scheduledStartTime: getTimeString,
    },
    styles: {
      description: TextInputStyle.Paragraph,
    },
  };
  modal.addComponents(
    serializeToModal(`${event.id}_`, serializationObject, serializationConfig)
  );

  return modal;
}
