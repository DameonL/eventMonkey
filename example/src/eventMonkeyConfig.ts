import { GuildScheduledEventEntityType } from "discord.js";
import eventMonkey, { EventMonkeyConfiguration } from "eventmonkey";

const announcement = {
  channel: "announcements",
  beforeStart: eventMonkey.time.toMilliseconds.minutes(30),
  onStart: true,
};

const configuration: EventMonkeyConfiguration = {
  commandName: "eventmonkey",
  eventTypes: [
    {
      name: "Meetup",
      description: "A hosted, in-person event",
      discussionChannel: "meetups",
      announcement,
      entityType: GuildScheduledEventEntityType.External,
      defaultImageUrl: "https://cdn.discordapp.com/attachments/895476102242394135/1084294974771843072/DALLE_2023-03-11_18.00.27_-_a_fantasy_calendar_digital_art.png"
    },
    {
      name: "Happening",
      description: "A freeform in-person without formal hosting",
      discussionChannel: "happenings",
      announcement,
      entityType: GuildScheduledEventEntityType.External,
      defaultImageUrl: "https://cdn.discordapp.com/attachments/895476102242394135/1084294974771843072/DALLE_2023-03-11_18.00.27_-_a_fantasy_calendar_digital_art.png"
    },
    {
      name: "🎤 Hangout",
      description: "A relaxed conversation in a voice channel",
      discussionChannel: "hangouts",
      channel: "Hangout",
      announcement,
      entityType: GuildScheduledEventEntityType.Voice,
      defaultImageUrl: "https://cdn.discordapp.com/attachments/895476102242394135/1084294974771843072/DALLE_2023-03-11_18.00.27_-_a_fantasy_calendar_digital_art.png"
    },
    {
      name: "🗣 Lecture",
      description: "A voice event with moderation and limited speakers",
      discussionChannel: "lectures",
      channel: "Lecture",
      announcement,
      entityType: GuildScheduledEventEntityType.StageInstance,
      defaultImageUrl: "https://cdn.discordapp.com/attachments/895476102242394135/1084294974771843072/DALLE_2023-03-11_18.00.27_-_a_fantasy_calendar_digital_art.png"
    },
  ],
  editingTimeout: eventMonkey.time.toMilliseconds.minutes(30),
  closeThreadsAfter: eventMonkey.time.toMilliseconds.days(1),
  timeZone: {
    name: "PST",
    offset: -8,
  },
};

export default configuration;