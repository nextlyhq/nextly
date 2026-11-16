/**
 * Whether a form is taking submissions now: its status, as core reads it for
 * every way a form is reached, then the form's closing time and its limit.
 *
 * Whatever closes a form (its author by hand, its closing time or its limit),
 * a visitor is told one thing: the form's closed message, or the generic
 * sentence when its author wrote none. That message is core's own answer for
 * a closed form, asked of this form, so the three causes cannot drift apart.
 *
 * @module utils/form-closing
 */
import {
  formAvailability,
  type FormAvailability,
  type FormAvailabilityInput,
} from "nextly";

import type { FormSettings } from "../types";

/** What closes a published form, beyond its status. */
export type ClosedBy = "date" | "limit";

/**
 * The message a visitor is given when this form is closed: core's answer for
 * the form had its author closed it, whether or not they did.
 */
export function closedMessageOf(form: FormAvailabilityInput): string {
  const asClosed = formAvailability({
    closedMessage: form.closedMessage,
    status: "closed",
    // Closed after being public, which is how core explains a form rather
    // than hiding it: a form past its closing time or its limit was live.
    wentLiveAt: "live",
  });
  if (asClosed.kind !== "closed") {
    throw new Error("a closed form that has been public explains itself");
  }
  return asClosed.message;
}

/** Whether the form's closing time has passed at `now`. */
export function pastClosingTime(
  settings: Pick<FormSettings, "closesAt">,
  now: Date
): boolean {
  if (settings.closesAt === undefined) return false;
  const closesAt = Date.parse(settings.closesAt);
  return Number.isFinite(closesAt) && now.getTime() >= closesAt;
}

/** Whether `taken` non-spam submissions fill the form's limit. */
export function limitReached(
  settings: Pick<FormSettings, "submissionLimit">,
  taken: number
): boolean {
  return (
    settings.submissionLimit !== undefined && taken >= settings.submissionLimit
  );
}

/**
 * The form's answer to a visitor now. Core decides by status first, so a
 * draft stays absent and a form closed by hand keeps its own answer; a
 * published one is then closed by its closing time, and by its limit when
 * `taken` (its non-spam submissions) is known.
 */
export function formAvailabilityNow(
  form: FormAvailabilityInput,
  settings: Pick<FormSettings, "closesAt" | "submissionLimit">,
  at: { now: Date; taken?: number }
): FormAvailability & { closedBy?: ClosedBy } {
  const byStatus = formAvailability(form);
  if (byStatus.kind !== "open") return byStatus;
  const closedBy = closedByNow(settings, at);
  return closedBy === undefined
    ? byStatus
    : { kind: "closed", message: closedMessageOf(form), closedBy };
}

/** What closes an open form now, if anything does. */
function closedByNow(
  settings: Pick<FormSettings, "closesAt" | "submissionLimit">,
  at: { now: Date; taken?: number }
): ClosedBy | undefined {
  if (pastClosingTime(settings, at.now)) return "date";
  if (at.taken !== undefined && limitReached(settings, at.taken)) {
    return "limit";
  }
  return undefined;
}
