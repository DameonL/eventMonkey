import { EventMonkeyEvent } from "./EventMonkeyEvent";
import logger from "./Logger";
import Time from "./Utility/Time";

const eventsUnderConstruction: UserEventMap = {};

interface UserEventMap {
  [userId: string]: [Date, EventMonkeyEvent];
}

export default {
  getEvent,
  saveEvent,
  deleteEvent,
  maintainEvents,
};

function getEvent(userId: string) {
  if (userId in eventsUnderConstruction) return eventsUnderConstruction[userId][1];

  return undefined;
}

function saveEvent(event: EventMonkeyEvent) {
  eventsUnderConstruction[event.author.id] = [new Date(), event];
}

function deleteEvent(userId: string) {
  delete eventsUnderConstruction[userId];
}

function maintainEvents() {
  logger.verbose && logger.log("Maintaining event construction cache...");
  try {
    const clearList: string[] = [];
    const now = new Date().valueOf();

    for (const userId in eventsUnderConstruction) {
      const eventTimestamp = eventsUnderConstruction[userId][0];
      if (Math.abs(now - eventTimestamp.valueOf()) >= Time.toMilliseconds.hours(2)) {
        clearList.push(userId);
      }
    }

    for (const userId of clearList) {
      delete eventsUnderConstruction[userId];
    }
  } catch (error) {
    logger.error("Error while maintaining events:", error);
  }
  logger.verbose && logger.log("Maintenance complete");

}
