// F10 PR 3 — barrel for the notifications module.

export type {
  MigrationNotificationEvent,
  MigrationScope,
  MigrationSummary,
  NotificationChannel,
  Notifier,
} from "./types";
export { createNotifier } from "./dispatcher";
export type { CreateNotifierOptions } from "./dispatcher";
export { buildNotificationEvent } from "./build-event";
export { TerminalChannel } from "./channels/terminal";
export { NDJSONChannel } from "./channels/ndjson";
export {
  getProductionNotifier,
  _resetProductionNotifierForTests,
} from "./production";
