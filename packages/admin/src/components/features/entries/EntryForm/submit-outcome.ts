/**
 * What one submission of a document form came to.
 *
 * The entry and Single editors used to resolve every submission alike, success
 * or not: errors went to a toast and the field messages, and the caller learned
 * nothing. A caller that has to act on the result — "save, then open the
 * builder", or a document action reporting back to the plugin that started it —
 * needs the outcome itself, so the one gate every submission passes through
 * resolves to this instead. The toasts and field messages are unchanged; this
 * is what the caller hears as well.
 *
 * @module components/features/entries/EntryForm/submit-outcome
 */
import { apiErrorMessage } from "@admin/lib/api/parseApiError";

/** Why a submission stored nothing. */
export type SubmitRefusal =
  /** The form's own validation refused it, before any request. */
  | "invalid"
  /** Writes are held: a colleague holds the document, or a past version is on screen. */
  | "refused"
  /** The request was made and the server, or the network, refused it. */
  | "failed"
  /** Another submission was still in flight. */
  | "busy";

export type SubmitOutcome =
  | { ok: true; item: { id: string } }
  | { ok: false; reason: SubmitRefusal; message: string };

/** A submission refused before it reached validation or the server. */
export const submitBusy: SubmitOutcome = {
  ok: false,
  reason: "busy",
  message:
    "A save is already in progress. Wait for it to finish, then try again.",
};

export const submitHeld: SubmitOutcome = {
  ok: false,
  reason: "refused",
  message:
    "This document can't be saved right now: someone else is editing it, or a past version is on screen.",
};

export const submitInvalid: SubmitOutcome = {
  ok: false,
  reason: "invalid",
  message: "Some fields need attention before this can be saved.",
};

/** A request the server or the network refused, in the words the toast uses. */
export function submitFailed(error: unknown): SubmitOutcome {
  return {
    ok: false,
    reason: "failed",
    message: apiErrorMessage(error, "The document couldn't be saved."),
  };
}
