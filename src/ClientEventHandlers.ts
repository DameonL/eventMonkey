import { EmbedBuilder, GuildScheduledEvent, GuildScheduledEventStatus, User } from "discord.js";
import Configuration from "./Configuration";
import eventAnnouncement from "./Content/Embed/eventAnnouncement";
import { deseralizeEventEmbed } from "./Content/Embed/eventEmbed";
import EventCreators from "./EventCreators";
import { EventAnnouncementType } from "./EventMonkeyConfiguration";
import logger from "./Logger";
import { getNextValidRecurrence } from "./Recurrence";
import Threads from "./Utility/Threads";
import Time from "./Utility/Time";
import { performEventAnnouncement } from "./Utility/performAnnouncements";
import { sendEventClosingMessage } from "./Utility/sendEventClosingMessage";

export default {
  eventStarted,
  eventCompleted,
  userShowedInterest,
};

async function eventStarted(oldEvent: GuildScheduledEvent | null, event: GuildScheduledEvent) {
  if (!event.description || !event.scheduledStartAt) return;
  if (!Configuration.discordClient) return;

  const thread = await Threads.getThreadFromEventDescription(event.description);
  if (!thread) return;
  const monkeyEvent = await deseralizeEventEmbed(thread, Configuration.discordClient);
  if (!monkeyEvent) {
    return;
  }

  const eventType = monkeyEvent.eventType;
  const startAnnouncements = eventType.announcements?.filter((x) => x.type === EventAnnouncementType.started);
  if (!startAnnouncements || startAnnouncements.length === 0) return;

  for (const announcement of startAnnouncements) {
    const announcementEmbed = await eventAnnouncement(monkeyEvent, announcement);

    performEventAnnouncement({
      announcement,
      event: monkeyEvent,
      announcementEmbed,
    });
  }
}

async function eventCompleted(oldEvent: GuildScheduledEvent | null, event: GuildScheduledEvent) {
  if (!event.guild || !event.description) return;

  try {
    const thread = await Threads.getThreadFromEventDescription(event.description);
    if (thread && !thread.archived) {
      const eventMonkeyEvent = await deseralizeEventEmbed(thread, event.client);
      if (!eventMonkeyEvent) {
        return;
      }

      const eventType = eventMonkeyEvent.eventType;
      const announcements = eventType.announcements?.filter((x) => x.type === EventAnnouncementType.ended);
      if (!announcements || announcements.length === 0) return;

      for (const announcement of announcements) {
        const announcementEmbed = await eventAnnouncement(eventMonkeyEvent, announcement);

        performEventAnnouncement({
          announcement,
          event: eventMonkeyEvent,
          announcementEmbed,
        });
      }

      if (eventMonkeyEvent.recurrence) {
        const { scheduledStartTime, scheduledEndTime } = getNextValidRecurrence(
          eventMonkeyEvent.recurrence,
          eventMonkeyEvent.duration
        );
        eventMonkeyEvent.scheduledStartTime = scheduledStartTime;
        eventMonkeyEvent.scheduledEndTime = scheduledEndTime;
        eventMonkeyEvent.scheduledEvent = undefined;
        eventMonkeyEvent.scheduledEvent = await EventCreators.createGuildScheduledEvent(
          eventMonkeyEvent,
          event.guild,
          thread
        );

        await EventCreators.createThreadChannelEvent(eventMonkeyEvent, event.guild);
        await thread.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("Event is over")
              .setDescription(
                `We'll see you next time at ${await Time.getTimeString(scheduledStartTime, event.guildId)}!`
              ),
          ],
        });
      } else {
        await sendEventClosingMessage(thread, GuildScheduledEventStatus.Completed);
        await Threads.closeEventThread(thread, event);
      }
    }
  } catch (error) {
    logger.error(JSON.stringify(error));
  }
}

async function userShowedInterest(guildScheduledEvent: GuildScheduledEvent<GuildScheduledEventStatus>, user: User) {
  if (!guildScheduledEvent.description) return;

  const thread = await Threads.getThreadFromEventDescription(guildScheduledEvent.description);

  if (!thread) return;

  await user.send({
    content: `Hi ${user.username}, I noticed you showed interest in ${guildScheduledEvent.name}!\nIf you'd like to signal you're attending, please visit the discussion thread at ${thread.url} and click the "Attending" button! You can always update your RSVP status if you change your mind!`,
  });
}
