import { ChannelType, Guild, GuildScheduledEventStatus, ThreadChannel } from "discord.js";
import Configuration from "../Configuration";
import { deseralizeEventEmbed } from "../Content/Embed/eventEmbed";
import EventCreators from "../EventCreators";
import { EventMonkeyEventType } from "../EventMonkeyConfiguration";
import logger from "../Logger";
import { getNextValidRecurrence } from "../Recurrence";
import { resolveChannelString } from "./resolveChannelString";

export async function restartRecurringEvents() {
  if (!Configuration.discordClient) return;

  for (const [guildName, guildAuth] of await Configuration.discordClient.guilds.fetch()) {
    const guild = await guildAuth.fetch();
    const configuration = await Configuration.getCurrent({ guildId: guild.id });
    for (const eventType of configuration.eventTypes) {
      try {
        await restartEventType(eventType, guild);
      } catch (error) {
        logger.error("Problem while trying to restart a recurring event:", error);
      }
    }
  }
}

async function restartEventType(eventType: EventMonkeyEventType, guild: Guild) {
  if (!Configuration.discordClient) return;

  const channel = await resolveChannelString(eventType.discussionChannel, guild);
  if (!channel) return;

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum) return;
  logger.verbose && logger.log(`Restarting event type ${eventType.name}`);

  for (const [threadId, thread] of (await channel.threads.fetchActive()).threads) {
    try {
      if (thread.ownerId === Configuration.discordClient.user?.id) {
        await restartThreadEvents(thread, guild);
      }
    } catch (error) {
      logger.error(`There was a problem restarting thread "${thread.name}"`, error);
    }
  }
}

async function restartThreadEvents(thread: ThreadChannel, guild: Guild) {
  logger.verbose && logger.log(`Restarting event in ${thread.name}`);
  const threadPins = [...(await thread.messages.fetchPinned())];
  if (threadPins.length === 0) return;
  if (threadPins.find((x) => x[1].embeds.at(0)?.title === "Event is Canceled")) return;

  const eventMonkeyEvent = await deseralizeEventEmbed(thread, Configuration.discordClient);
  if (!eventMonkeyEvent) {
    return;
  }

  if (
    eventMonkeyEvent.recurrence &&
    (!eventMonkeyEvent.scheduledEvent ||
      eventMonkeyEvent.scheduledEvent.status === GuildScheduledEventStatus.Completed ||
      eventMonkeyEvent.scheduledEvent.status === GuildScheduledEventStatus.Canceled)
  ) {
    const { scheduledStartTime, scheduledEndTime } = getNextValidRecurrence(
      eventMonkeyEvent.recurrence,
      eventMonkeyEvent.duration
    );
    eventMonkeyEvent.scheduledStartTime = scheduledStartTime;
    eventMonkeyEvent.scheduledEndTime = scheduledEndTime;
    eventMonkeyEvent.scheduledEvent = undefined;
    eventMonkeyEvent.scheduledEvent = await EventCreators.createGuildScheduledEvent(eventMonkeyEvent, guild, thread);
    await EventCreators.createThreadChannelEvent(eventMonkeyEvent, guild);
  }
}
