/**
 * The record of content events: what happened to a document or a release,
 * who or what did it, and when.
 *
 * @module domains/content-events
 * @experimental
 */

export { contentEventActor, type ContentEventActor } from "./actor";
export {
  contentEventKind,
  contentEventKindNames,
  registerContentEventKind,
  renderContentEvent,
  type ContentEventKind,
} from "./kinds";
export {
  recordContentEvent,
  type ContentEventInput,
  type ContentEventSubject,
  type RecordContentEventOptions,
} from "./record";
export {
  ContentEventsRepository,
  type ContentEventQuery,
  type ContentEventRecord,
} from "./repository";
