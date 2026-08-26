/**
 * What a form says to a visitor who reaches it.
 *
 * One answer, because there are four public ways to reach a form — the by-slug
 * endpoint, the submit endpoint, the Direct API, and the plugin's own handler —
 * and each of them used to decide this for itself. They disagreed: one filtered
 * closed forms out and answered 404, one returned a fixed sentence, and one
 * returned the author's message, so what a visitor was told depended on which
 * entry point their client happened to use.
 *
 * @module domains/forms/form-availability
 */

/** What every path says when it has no better answer, and the only one a form that was never public gets. */
export const GENERIC_REFUSAL =
  "This form is not currently accepting submissions";

/**
 * A form's answer to a visitor.
 *
 * `absent` carries WHY for the log, and only for the log. A form that does not
 * exist and one that has never been public answer identically on the wire: a
 * different answer for the second would let anyone discover unreleased forms by
 * probing slugs.
 */
export type FormAvailability =
  | { kind: "open" }
  | { kind: "closed"; message: string }
  | { kind: "absent"; reason: "no-such-form" | "never-published" };

/** The fields this decision reads. Anything form-shaped satisfies it. */
export interface FormAvailabilityInput {
  status?: unknown;
  closedMessage?: unknown;
  /** When the form first went live. Absent on one that never has. */
  wentLiveAt?: unknown;
}

/**
 * Whether this form has ever been public.
 *
 * Read from a stamp rather than inferred from `status`, because `closed` does
 * not imply a prior `published`: the collection accepts `closed` on creation
 * and on a straight draft-to-closed edit. Treating the two as one is what let a
 * guessed slug return the fields and configuration of a form nobody had ever
 * released.
 *
 * A row written before the stamp existed has none, and so reads as never
 * public — the safe answer, and one an author corrects by publishing once.
 */
function hasBeenPublic(form: FormAvailabilityInput): boolean {
  const stamp = form.wentLiveAt;
  return stamp !== undefined && stamp !== null && stamp !== "";
}

/** The author's explanation, or the generic sentence when they wrote none. */
function closedMessageOf(form: FormAvailabilityInput): string {
  // Trimmed rather than trusted: the field is a textarea, and whitespace is
  // not a message.
  const authored =
    typeof form.closedMessage === "string" ? form.closedMessage.trim() : "";
  return authored || GENERIC_REFUSAL;
}

export function formAvailability(
  form: FormAvailabilityInput | null | undefined
): FormAvailability {
  if (!form) return { kind: "absent", reason: "no-such-form" };
  if (form.status === "published") return { kind: "open" };
  if (form.status === "closed" && hasBeenPublic(form)) {
    return { kind: "closed", message: closedMessageOf(form) };
  }
  return { kind: "absent", reason: "never-published" };
}
