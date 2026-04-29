// F10 PR 3 — barrel for the notifications module.

export type {
  MigrationNotificationEvent,
  MigrationScope,
  MigrationSummary,
  NotificationChannel,
  Notifier,
} from "./types.js";
export { createNotifier } from "./dispatcher.js";
export type { CreateNotifierOptions } from "./dispatcher.js";
export { buildNotificationEvent } from "./build-event.js";
export { TerminalChannel } from "./channels/terminal.js";
export { NDJSONChannel } from "./channels/ndjson.js";
export {
  getProductionNotifier,
  _resetProductionNotifierForTests,
} from "./production.js";
