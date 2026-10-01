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
  UserEvents,
  type DocumentEventName,
  type AuthEventName,
  type MediaEventName,
  type UserEventName,
  type UserCreatedPayload,
  type UserDeletedPayload,
} from "./event-names";
