import {
  ActionRowBuilder,
  ChannelType,
  Client,
  GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  ModalActionRowComponentBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputComponent,
  TextInputStyle,
  ThreadChannel,
  VoiceBasedChannel,
} from "discord.js";
import { configuration } from "./EventMonkey";
import { EventMonkeyEvent } from "./EventMonkeyEvent";
import { deserialize as deserializeRecurrence, EventRecurrence } from "./Recurrence";

export interface ModalSerializationConfig {
  labels?: {
    [fieldName: string]: string;
  };
  styles?: {
    [fieldName: string]: TextInputStyle;
  };
  formatters?: {
    [fieldName: string]: (fieldValue: any) => string;
  };
}

export function serializeToModal(
  prefix: string,
  target: any,
  config?: ModalSerializationConfig
): ActionRowBuilder<TextInputBuilder>[] {
  const output: ActionRowBuilder<TextInputBuilder>[] = [];

  for (const fieldName in target) {
    let label = config?.labels?.[fieldName] ?? fieldName;
    let style = config?.styles?.[fieldName] ?? TextInputStyle.Short;
    let value = target[fieldName];
    if (config?.formatters?.[fieldName])
      value = config.formatters[fieldName](target[fieldName]);

    value = value.toString();

    output.push(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setLabel(label)
          .setCustomId(`${prefix}${fieldName}`)
          .setStyle(style)
          .setValue(value)
      )
    );
  }

  return output;
}

export interface ModalDeserializationConfig {
  validators?: {
    [fieldName: string]:
      | ((fieldValue: string) => string | undefined)
      | undefined;
  };
  customDeserializers?: {
    [fieldName: string]: ((fieldValue: string) => any) | undefined;
  };
}

export function deserializeModalFields<T>(
  fields: IterableIterator<[string, TextInputComponent]>,
  deserializeTarget?: any,
  config?: ModalDeserializationConfig
) {
  const fieldPrefix = `${deserializeTarget.id}_`;
  const output: any = deserializeTarget ?? {};
  for (let [fullFieldName, fieldComponent] of fields) {
    fullFieldName = fullFieldName.replace(fieldPrefix, "");
    const splitFieldName = fullFieldName.split(".");
    let currentObject = output;
    for (let i = 0; i < splitFieldName.length; i++) {
      const fieldName = splitFieldName[i];
      if (i < splitFieldName.length - 1) {
        if (!currentObject[fieldName]) {
          const newObject = {};
          currentObject[fieldName] = newObject;
          currentObject = newObject;
        } else {
          currentObject = currentObject[fieldName];
        }
      } else {
        if (config?.validators?.[fullFieldName]) {
          const validationResponse = config.validators[fieldName]?.(
            fieldComponent.value
          );
          if (validationResponse) {
            throw new Error(validationResponse);
          }
        }

        if (config?.customDeserializers?.[fullFieldName]) {
          currentObject[fieldName] = config.customDeserializers?.[
            fullFieldName
          ]?.(fieldComponent.value);
        } else {
          currentObject[fieldName] = fieldComponent.value.trim();
        }
      }
    }
  }

  return output as T;
}

export function getEventNameFromString(text: string): string {
  const matches = text.match(/(AM|PM) - (?<name>.*)(?= hosted by)/i);
  if (!matches || !matches.groups)
    throw new Error("Unable to parse event name from string.");

  return matches.groups.name;
}

async function getPreviewEmbed(thread: ThreadChannel) {
  const pinnedMessages = await thread.messages.fetchPinned();
  const embed = pinnedMessages.at(pinnedMessages.values.length - 1)?.embeds[0];
  if (!embed) throw new Error("Unable to find event embed for thread.");
  return embed;
}

export async function deseralizePreviewEmbed(
  thread: ThreadChannel,
  client: Client
): Promise<EventMonkeyEvent> {
  const embed = await getPreviewEmbed(thread);

  const id = embed.fields.find((x) => x.name === "Event ID")?.value;
  if (!id) throw new Error("Unable to get ID from embed.");

  const userMatches = embed.author?.name.match(
    /(?<username>\w*) \((?<userId>.*)\)$/i
  );

  if (!userMatches || !userMatches.groups)
    throw new Error("Unable to parse embed.");

  const userId = userMatches.groups.userId;
  const author = client.users.cache.get(userId);
  if (!author) throw new Error("Unable to resolve user ID from embed.");

  const scheduledStartTime = getTimeFromString(thread.name);
  const name = getEventNameFromString(thread.name);

  const image = embed.thumbnail?.url ?? "";
  const duration = Number(
    embed.fields
      .find((x) => x.name === "Duration")
      ?.value.replace(" hours", "")
      .replace(" hour", "") ?? 1
  );
  const location = embed.fields.find((x) => x.name === "Location")?.value;
  const channelLink = embed.fields.find((x) => x.name === "Channel")?.value;
  const channelId = channelLink
    ? channelLink?.match(/(?<=https:\/\/discord.com\/channels\/\d+\/)\d+/i)?.[0]
    : undefined;
  const channel = channelId
    ? (client.channels.cache.get(channelId) as TextChannel | VoiceBasedChannel)
    : undefined;
  const entityType =
    channel == undefined
      ? GuildScheduledEventEntityType.External
      : channel.type === ChannelType.GuildStageVoice
      ? GuildScheduledEventEntityType.StageInstance
      : GuildScheduledEventEntityType.Voice;

  const eventLink = embed.fields.find((x) => x.name === "Event Link");
  const eventId = eventLink?.value.match(
    /(?<=https:\/\/discord.com\/events\/.*\/).*/i
  )?.[0];
  if (!eventId) throw new Error("Unable to deserialize event ID.");

  let scheduledEvent: GuildScheduledEvent | undefined = undefined;
  for (const [guildId, guild] of client.guilds.cache.entries()) {
    try {
      scheduledEvent = await guild.scheduledEvents.fetch(eventId);
    } catch {
      continue;
    }
  }
  let recurrence: EventRecurrence | undefined = undefined;
  const frequencyField = embed.fields.find(x => x.name === "Frequency");
  recurrence = frequencyField ? deserializeRecurrence(frequencyField.value) : undefined;

  const output = {
    name,
    scheduledStartTime,
    author,
    description: embed.description ?? "",
    image,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    duration: duration,
    forumChannelId: thread.parentId ?? "",
    entityMetadata: { location: location ?? channel?.name ?? "" },
    entityType,
    threadChannel: thread,
    scheduledEvent,
    id,
    recurrence
  };

  return output;
}

export function getTimeFromString(text: string): Date {
  const matches = text.match(
    /(?<time>\d\d?\/\d\d?\/\d\d(\d\d)?,? \d\d?:\d\d\s(AM|PM)( [a-z]{3})?)/i
  );
  if (!matches || !matches.groups)
    throw new Error("Unable to parse date from string.");

  const output = new Date(matches.groups.time);
  return output;
}

export function getTimeString(date: Date): string {
  return date
    .toLocaleString("en-us", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: configuration.timeZone
        ? configuration.timeZone
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeZoneName: "short",
    })
    .replace(",", "")
    .replace(" ", " ");
}

export async function getAttendeeIds(thread: ThreadChannel) {
  const attendees = (await getAttendeeTags(thread))?.replace(/[^0-9\s]/ig, "").split("\n") ?? "";
  return attendees;
}

export async function getAttendeeTags(thread: ThreadChannel) {
  const embedMessage = (await thread.messages.fetchPinned()).find(x => x.embeds.find(x => x.title === "Attendees"));
  if (!embedMessage) return null;
  const threadEmbed = embedMessage.embeds.at(1);

  const attendeeField = threadEmbed?.fields.find(
    (x) => x.name === "Attending"
  );
  if (!attendeeField) throw new Error("Unable to find attending field.");

  const attendees = attendeeField.value.replace(/\n/ig, " ");
  return attendees;
}