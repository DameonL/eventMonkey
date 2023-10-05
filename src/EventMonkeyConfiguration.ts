import { Client, GuildScheduledEventEntityType } from "discord.js";
import { EventMonkeyEvent } from "./EventMonkeyEvent";

export interface EventMonkeyConfiguration {
  commandName: string;
  discordClient?: Client;
  editingTimeout: number;
  eventTypes: EventMonkeyEventType[];
  timeZones: EventMonkeyTimeZone[];
  closeThreadsAfter?: number;
  roles?: {
    allowed?: string[];
    denied?: string[];
  };
}

export interface EventMonkeyTimeZone {
  name: string;
  offset: number;
  start?: Date;
  end?: Date;
}

export interface BaseEventMonkeyEventType {
  name: string;
  description?: string;
  discussionChannel: string;
  announcements?: EventAnnouncement[];
  defaultImageUrl?: string;
}

export interface EventMonkeyEventTypeExternal extends BaseEventMonkeyEventType {
  entityType: GuildScheduledEventEntityType.External;
}

export interface EventMonkeyEventTypeVoice extends BaseEventMonkeyEventType {
  entityType: GuildScheduledEventEntityType.Voice;
  channel: string | string[];
}

export interface EventMonkeyEventTypeStage extends BaseEventMonkeyEventType {
  entityType: GuildScheduledEventEntityType.StageInstance;
  channel: string | string[];
}

export type EventMonkeyEventType = EventMonkeyEventTypeExternal | EventMonkeyEventTypeStage | EventMonkeyEventTypeVoice;

export interface BaseEventAnnouncement {
  channel?: string | string[];
  message?: string | ((event: EventMonkeyEvent, announcement: EventAnnouncement) => string);
  mention?: {
    attendees?: boolean;
    here?: boolean;
    everyone?: boolean;
  };
}

export enum EventAnnouncementType {
  starting = "Starting",
  started = "Started",
  ending = "Ending",
  ended = "Ended",
}

export interface EventAnnouncementStarting extends BaseEventAnnouncement {
  type: EventAnnouncementType.starting;
  timeBefore: number;
}

export interface EventAnnouncementStarted extends BaseEventAnnouncement {
  type: EventAnnouncementType.started;
}

export interface EventAnnouncementEnding extends BaseEventAnnouncement {
  type: EventAnnouncementType.ending;
  timeBefore: number;
}

export interface EventAnnouncementEnded extends BaseEventAnnouncement {
  type: EventAnnouncementType.ended;
}

export type EventAnnouncement =
  | EventAnnouncementStarting
  | EventAnnouncementStarted
  | EventAnnouncementEnding
  | EventAnnouncementEnded;
