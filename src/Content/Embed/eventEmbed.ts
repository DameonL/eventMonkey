import {
  APIEmbedField,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  Message,
  ThreadChannel,
} from "discord.js";
import Configuration from "../../Configuration";
import { EventMonkeyEvent } from "../../EventMonkey";
import { ExternalEvent, PartialEventMonkeyEvent, StageEvent, VoiceEvent } from "../../EventMonkeyEvent";
import { EventRecurrence, deserializeRecurrence, serializeRecurrence } from "../../Recurrence";
import Time from "../../Utility/Time";
import { getAttendeesFromMessage } from "./attendees";

export async function eventEmbed(event: EventMonkeyEvent, guildId: string): Promise<EmbedBuilder> {
  const previewEmbed = new EmbedBuilder();
  previewEmbed.setTitle("Event Details");

  previewEmbed.setDescription(event.description);

  if (event.scheduledEvent) {
    previewEmbed.setURL(event.scheduledEvent.url);
  }

  previewEmbed.setAuthor({
    name: `${event.author.username} (${event.author.id})`,
    iconURL: event.author.avatarURL() ?? undefined,
  });

  const fields: APIEmbedField[] = [
    {
      name: "Type",
      value: event.eventType.name,
    },
    {
      name: "Location",
      value:
        event.entityType === GuildScheduledEventEntityType.External
          ? event.entityMetadata.location
          : event.channel?.toString() ?? "To be determined",
      inline: true,
    },
    {
      name: "Duration",
      value: `${event.duration} hour${event.duration > 1 ? "s" : ""}`,
      inline: true,
    },
  ];

  if (event.recurrence) {
    fields.push({
      name: "Frequency",
      value: await serializeRecurrence(event.recurrence, guildId),
    });
  }

  if (event.maxAttendees) {
    fields.push({
      name: "Max Attendees",
      value: event.maxAttendees.toString(),
    });
  }
  fields.push({ name: "Event ID", value: event.id });

  previewEmbed.addFields(fields);
  return previewEmbed;
}

export async function deseralizeEventEmbed(
  thread: ThreadChannel,
  client: Client
): Promise<EventMonkeyEvent<StageEvent | VoiceEvent | ExternalEvent> | undefined> {
  if (thread.ownerId !== client.user?.id) {
    return undefined;
  }

  const detailsMessage = await getEventDetailsMessage(thread);
  if (!detailsMessage) {
    return undefined;
  }

  const embed = await getEventDetailsEmbed(detailsMessage);

  const id = embed.fields.find((x) => x.name === "Event ID")?.value;
  if (!id) throw new Error("Unable to get ID from embed.");

  const userMatches = embed.author?.name.match(/(?<username>\w*) \((?<userId>.*)\)$/i);

  if (!userMatches || !userMatches.groups) throw new Error("Unable to parse embed.");

  const userId = userMatches.groups.userId;
  const author = client.users.cache.get(userId);
  if (!author) throw new Error("Unable to resolve user ID from embed.");

  const eventTypeName = embed.fields.find((x) => x.name === "Type")?.value;
  if (!eventTypeName) throw new Error();

  const configuration = await Configuration.getCurrent({ guildId: thread.guildId });

  const eventType = configuration.eventTypes.find((x) => x.name === eventTypeName);
  if (!eventType) throw new Error();

  const scheduledStartTime = await Time.getTimeFromString(thread.name, thread.guildId);
  const name = getEventNameFromString(thread.name);
  const image = detailsMessage.attachments.first()?.url;

  const duration = Number(
    embed.fields
      .find((x) => x.name === "Duration")
      ?.value.replace(" hours", "")
      .replace(" hour", "") ?? 1
  );
  const location = embed.fields.find((x) => x.name === "Location")?.value;
  if (!location) throw new Error();

  const maxAttendees = embed.fields.find((x) => x.name === "Max Attendees");

  const eventId = embed.url?.match(/(?<=https:\/\/discord.com\/events\/.*\/).*/i)?.[0];

  let scheduledEvent: GuildScheduledEvent | undefined = undefined;
  if (eventId) {
    for (const [guildId, guild] of client.guilds.cache.entries()) {
      try {
        scheduledEvent = await guild.scheduledEvents.fetch(eventId);
      } catch {
        continue;
      }
    }
  }

  let recurrence: EventRecurrence | undefined = undefined;
  const frequencyField = embed.fields.find((x) => x.name === "Frequency");
  recurrence = frequencyField ? await deserializeRecurrence(frequencyField.value, thread.guildId) : undefined;

  const attendees = getAttendeesFromMessage(detailsMessage);

  const baseEvent: PartialEventMonkeyEvent = {
    name,
    scheduledStartTime,
    author,
    description: embed.description ?? "",
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    duration: duration,
    discussionChannelId: thread.parentId ?? "",
    threadChannel: thread,
    scheduledEvent,
    image,
    id,
    recurrence,
    attendees,
    entityType: eventType.entityType,
    maxAttendees: maxAttendees?.value && !isNaN(Number(maxAttendees.value)) ? Number(maxAttendees.value) : undefined,
  };

  if (eventType.entityType === GuildScheduledEventEntityType.External) {
    return {
      ...baseEvent,
      eventType,
      entityMetadata: { location },
      entityType: GuildScheduledEventEntityType.External,
    };
  } else if (eventType.entityType === GuildScheduledEventEntityType.Voice) {
    const locationChannel = location?.match(/(?<=<#)\d+(?=>)/)?.[0];
    const channel = locationChannel ? client.channels.cache.get(locationChannel) : undefined;
    if (channel && channel.type !== ChannelType.GuildVoice) throw new Error();

    return { ...baseEvent, eventType, channel, entityType: GuildScheduledEventEntityType.Voice };
  } else {
    const locationChannel = location?.match(/(?<=<#)\d+(?=>)/)?.[0];
    const channel = locationChannel ? client.channels.cache.get(locationChannel) : undefined;
    if (channel && channel.type !== ChannelType.GuildStageVoice) throw new Error();

    return { ...baseEvent, eventType, channel, entityType: GuildScheduledEventEntityType.StageInstance };
  }
}

export async function getEventDetailsEmbed(message: Message) {
  const embed = message.embeds?.find((x) => x.title === "Event Details");

  if (!embed) {
    throw new Error(`Unable to find event embed on message.\n${JSON.stringify(message)}`);
  }
  return embed;
}

export async function getEventDetailsMessage(thread: ThreadChannel) {
  const pinnedMessages = await thread.messages.fetchPinned();
  return pinnedMessages.find((value, key) => value.embeds.find((embed) => embed.title === "Event Details"));
}

export function getEventNameFromString(text: string): string {
  const matches = text.match(/(AM|PM)(\s+\w+)?\s+-\s+(?<name>.*)(?= hosted by)/i);
  if (!matches || !matches.groups) throw new Error(`Unable to parse event name from string: ${text}`);

  return matches.groups.name;
}
