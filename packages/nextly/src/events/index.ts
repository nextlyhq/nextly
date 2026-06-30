/**
 * Plugin event bus (D8/D51).
 *
 * @module events
 */

export {
  EventBus,
  getEventBus,
  resetEventBus,
  type EventEnvelope,
  type EventHandler,
  type EventName,
} from "./event-bus";

export {
  safeEmit,
  emitDocumentEvent,
  emitAuthEvent,
  emitMediaEvent,
} from "./domain-events";

export {
  DocumentEvents,
  AuthEvents,
  MediaEvents,
  type DocumentEventName,
  type AuthEventName,
  type MediaEventName,
} from "./event-names";
