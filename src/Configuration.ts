import {
  EventMonkeyConfiguration,
} from "./EventMonkeyConfiguration";
import Time from "./Utility/TimeUtilities";

let configuration: EventMonkeyConfiguration = defaultConfiguration();
function defaultConfiguration(): EventMonkeyConfiguration {
  return {
    commandName: "event",
    eventTypes: [],
    editingTimeout: Time.toMilliseconds.minutes(30),
  };
}

export default {
  defaultConfiguration,
  get current() { return configuration },
  set current(value: EventMonkeyConfiguration) {
    configuration = value;
  }
};
