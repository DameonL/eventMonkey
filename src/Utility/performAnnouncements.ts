import { APIEmbed, ChannelType, GuildScheduledEvent, GuildScheduledEventStatus } from "discord.js";
import Configuration from "../Configuration";
import { attendeeTags } from "../Content/Embed/attendees";
import eventAnnouncement, { getFooter, getTitle } from "../Content/Embed/eventAnnouncement";
import { deseralizeEventEmbed } from "../Content/Embed/eventEmbed";
import { EventAnnouncement, EventAnnouncementType } from "../EventMonkeyConfiguration";
import { EventMonkeyEvent } from "../EventMonkeyEvent";
import logger from "../Logger";
import Threads from "./Threads";
import Time from "./Time";
import { resolveChannelString } from "./resolveChannelString";

export async function performAnnouncements() {
  if (!Configuration.discordClient) return;

  try {
    for (const guild of Configuration.discordClient.guilds.cache.values()) {
      for (const event of (await guild.scheduledEvents.fetch()).values()) {
        performEventAnnouncements(event);
      }
    }
  } catch (error) {
    logger.error("Error while performing announcments", error);
  }
}

export async function performEventAnnouncements(event: GuildScheduledEvent) {
  if (!event.description || !event.scheduledStartAt || !event.guild) return;

  const thread = await Threads.getThreadFromEventDescription(event.description);
  if (!thread) return;

  const configuration = await Configuration.getCurrent({ guildId: event.guildId });
  const eventType = configuration.eventTypes.find(
    (x) => x.discussionChannel === thread.parent?.id || x.discussionChannel === thread.parent?.name
  );
  if (!eventType || !eventType.announcements) return;

  const monkeyEvent = await deseralizeEventEmbed(thread, event.client);
  if (!monkeyEvent) {
    return;
  }

  for (const announcement of eventType.announcements) {
    if (announcement.type !== EventAnnouncementType.starting && announcement.type !== EventAnnouncementType.ending) {
      continue;
    }

    if (announcement.type === EventAnnouncementType.starting) {
      const timeBeforeStart = monkeyEvent.scheduledEvent?.scheduledStartAt
        ? monkeyEvent.scheduledEvent.scheduledStartAt.valueOf() - new Date().valueOf()
        : undefined;

      if (!timeBeforeStart) {
        logger.error("Unable to determine the time before event starts.", monkeyEvent);
      }

      if (
        !timeBeforeStart ||
        timeBeforeStart < Time.toMilliseconds.minutes(1) ||
        timeBeforeStart > announcement.timeBefore ||
        event.status === GuildScheduledEventStatus.Active
      ) {
        continue;
      }
    } else if (announcement.type === EventAnnouncementType.ending) {
      const timeBeforeEnd = monkeyEvent.scheduledEvent?.scheduledEndAt
        ? monkeyEvent.scheduledEvent?.scheduledEndAt.valueOf() - new Date().valueOf()
        : undefined;

      if (!timeBeforeEnd) {
        logger.error("Unable to determine the time before event ends.", monkeyEvent);
      }

      if (
        !timeBeforeEnd ||
        timeBeforeEnd < Time.toMilliseconds.minutes(1) ||
        timeBeforeEnd > announcement.timeBefore ||
        event.status !== GuildScheduledEventStatus.Active
      ) {
        continue;
      }
    }

    const announcementEmbed = await eventAnnouncement(monkeyEvent, announcement);
    performEventAnnouncement({ announcement, event: monkeyEvent, announcementEmbed });
  }
}

export async function performEventThreadAnnouncement(options: {
  announcement: EventAnnouncement;
  announcementEmbed: APIEmbed;
  event: EventMonkeyEvent;
}) {
  const thread = options.event.threadChannel;
  if (!thread) {
    return;
  }

  const eventTitle = await getTitle(options.event, options.announcement);

  let threadAnnouncement = (await thread.messages.fetch()).find((x) =>
    x.embeds.find((x) => x.footer?.text === getFooter(options.event) && x.title === eventTitle)
  );

  if (!threadAnnouncement) {
    return;
  }

  try {
    thread.send({ content: await getAnnouncementMessage(options), embeds: [options.announcementEmbed] });
  } catch (error) {
    logger.error("Error sending event announcement to thread:", {
      announcementEmbed: options.announcementEmbed,
      error,
    });
  }
}

async function getAnnouncementMessage(options: {
  announcement: EventAnnouncement;
  event: EventMonkeyEvent;
}): Promise<string> {
  let mentions = "";

  if (!options.event.threadChannel) {
    logger.warn("Unable to get threadChannel for event");
  }

  if (options.announcement.mention) {
    const mentionOptions = options.announcement.mention;

    if (mentionOptions.at) {
      for (const mention of mentionOptions.at) {
        mentions += `${mentions !== "" ? " " : ""}@${mention}`;
      }
    }

    if (options.event.threadChannel && mentionOptions.attendees) {
      mentions += `${mentions !== "" ? " " : ""}${await attendeeTags(options.event.threadChannel)}`;
    }
  }

  let message: string | undefined;
  if (typeof options.announcement.message === "function") {
    message = options.announcement.message(options.event, options.announcement);
  } else {
    message = options.announcement.message;
  }

  const content = `${message ? `${message}\n` : ""}${mentions}`;
  return content;
}

export async function performEventAnnouncement(options: {
  announcement: EventAnnouncement;
  event: EventMonkeyEvent;
  announcementEmbed: APIEmbed;
}) {
  if (!options.event.scheduledEvent?.guild) {
    logger.error("No guild or scheduledEvent found.", options.event);
    return;
  }

  const announcementChannels = Array.isArray(options.announcement.channel)
    ? options.announcement.channel
    : options.announcement.channel
    ? [options.announcement.channel]
    : [];

  for (const channelId of announcementChannels) {
    const announcementChannel = await resolveChannelString(channelId, options.event.scheduledEvent.guild);
    if (
      !announcementChannel ||
      (announcementChannel.type !== ChannelType.GuildText && announcementChannel.type !== ChannelType.GuildAnnouncement)
    )
      continue;

    const existingAnnouncement = (await announcementChannel.messages.fetch()).find((x) =>
      x.embeds.find(
        (x) => x.footer?.text === options.announcementEmbed.footer?.text && x.title === options.announcementEmbed.title
      )
    );

    if (!existingAnnouncement) {
      try {
        announcementChannel.send({
          content: await getAnnouncementMessage({ announcement: options.announcement, event: options.event }),
          embeds: [options.announcementEmbed],
        });
      } catch (error) {
        logger.error("Error sending event announcement to channel:", { embed: options.announcementEmbed, error });
      }
    }
  }
}
