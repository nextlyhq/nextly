import { getEventBus } from "./event-bus";

/**
 * @experimental Best-effort emit: never throws into the caller. Use at
 * post-commit reaction boundaries (D8/D51) where event dispatch must not
 * affect the operation's result.
 */
export function safeEmit(name: string, payload: unknown): void {
  try {
    getEventBus().emit(name, payload);
  } catch {
    // Swallow — event delivery is best-effort and must never surface to callers.
  }
}

/** @experimental D69 document-level lifecycle events. */
export function emitDocumentEvent(
  event: "published" | "statusChanged",
  collection: string,
  payload: Record<string, unknown>
): void {
  safeEmit(`document.${event}`, { collection, ...payload });
}

/** @experimental D69 auth-domain events. */
export function emitAuthEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  safeEmit(`auth.${event}`, payload);
}

/** @experimental D69 media-domain events. */
export function emitMediaEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  safeEmit(`media.${event}`, payload);
}
