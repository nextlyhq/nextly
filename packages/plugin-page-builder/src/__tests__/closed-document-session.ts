/**
 * A session on a second document that is never opened, for tests that mock
 * `@nextlyhq/plugin-sdk/admin` around a whole editor: the editor asks for one
 * as it mounts, to edit a header or footer in place, and opens none unless
 * the author asks to.
 *
 * @module __tests__/closed-document-session
 */
import type { DocumentSession } from "@nextlyhq/plugin-sdk/admin";

/** What the SDK's `useDocumentSession` answers while no document is named. */
export function closedDocumentSession(): DocumentSession {
  return {
    open: { status: "loading" },
    lock: { status: "claiming" },
    mayPublish: false,
    saveDraft: () =>
      Promise.resolve({ ok: false, reason: "unread", message: null }),
    publish: () =>
      Promise.resolve({ ok: false, reason: "unread", message: null }),
    record: () => undefined,
    discard: () => Promise.resolve(),
    writesSettled: () => Promise.resolve(null),
  };
}
