/**
 * One response per person: the key a submission is compared by.
 *
 * A form that takes one response per person keeps, beside each non-spam
 * submission, a keyed one-way digest of what tells one person from another:
 * the answer to its chosen Email field (compared ignoring case) or the
 * network address the submission came from. The address itself is never
 * stored a second time, and the digest cannot be reversed without the
 * plugin's key (`ctx.security.digests`). A unique index on the form and the
 * key refuses a second submission with the same key at its insert, so two
 * that arrive at once cannot both be stored.
 *
 * @module handlers/one-response
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import type { FormSettings } from "../types";

/** What a visitor sending a second response is told. */
export const ALREADY_RESPONDED = "You have already submitted this form.";

type Digests = PluginContext["security"]["digests"];

/** The parts of a submission its key is made from. */
export interface KeyedSubmission {
  status?: unknown;
  ipAddress?: unknown;
  data?: unknown;
}

/** A non-empty string, trimmed, or undefined. */
function textOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * A submission's answers as an object: as written, or as a stored row holds
 * them before a read decodes them, a JSON string.
 */
function answersOf(data: unknown): Record<string, unknown> | undefined {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The answer to `field` in a submission's data. */
function answerOf(data: unknown, field: string | undefined): unknown {
  return field === undefined ? undefined : answersOf(data)?.[field];
}

/**
 * The submission's key under the form's one-response setting, or null when
 * it has none: the form allows several responses, the submission is spam,
 * or what the mode compares is missing (a submission with no address). A
 * browser's token comes with the submission itself, not from what is stored.
 */
export async function responseKeyOf(
  /** Read only when a key is made: most forms allow several responses. */
  digests: () => Digests,
  settings: Pick<FormSettings, "oneResponse" | "oneResponseField">,
  submission: KeyedSubmission
): Promise<string | null> {
  if (submission.status === "spam") return null;
  switch (settings.oneResponse) {
    case "ip": {
      const address = textOf(submission.ipAddress);
      return address === undefined ? null : digests().digest("ip", address);
    }
    case "email": {
      const email = textOf(
        answerOf(submission.data, settings.oneResponseField)
      );
      return email === undefined
        ? null
        : digests().digest("email", email.toLowerCase());
    }
    default:
      return null;
  }
}

/** Whether an update changes what a submission's key is made from. */
export function touchesResponseKey(patch: KeyedSubmission): boolean {
  return (
    patch.status !== undefined ||
    patch.data !== undefined ||
    patch.ipAddress !== undefined
  );
}

/**
 * A submission's key after an update, made from the stored row with the
 * update applied: none once it is spam; its own again when restored from
 * spam, unless another submission has since taken that value, when it keeps
 * none and the value stays with that one; a new one when its answer or
 * address changed, which the unique index refuses if another submission
 * holds it already, so an edit cannot give two submissions one value; and,
 * when the value is unchanged, what it held.
 */
export async function responseKeyAfterUpdate(input: {
  digests: () => Digests;
  settings: Pick<FormSettings, "oneResponse" | "oneResponseField">;
  patch: KeyedSubmission;
  stored: (KeyedSubmission & { responseKey?: unknown }) | undefined;
  /** Whether another submission of the form holds `key`. */
  heldElsewhere: (key: string) => Promise<boolean>;
  /** Whether the update moves the submission to another form. */
  moved: boolean;
}): Promise<string | null> {
  const { patch, stored } = input;
  const key = await responseKeyOf(input.digests, input.settings, {
    status: patch.status ?? stored?.status,
    data: patch.data ?? stored?.data,
    ipAddress: patch.ipAddress ?? stored?.ipAddress,
  });
  if (key === null) return null;
  const storedValue = await responseKeyOf(input.digests, input.settings, {
    data: stored?.data,
    ipAddress: stored?.ipAddress,
  });
  // Edited to another value, or moved to another form whose responses it
  // now joins: that value's key, which the unique index refuses if another
  // submission of the form holds it.
  if (input.moved || key !== storedValue) return key;
  // Restored from spam with the value it was stored with: its key back,
  // unless another submission has taken that value since.
  if (stored?.status === "spam") {
    return (await input.heldElsewhere(key)) ? null : key;
  }
  // The same value, not spam before or after: whatever it held, a key or,
  // restored while its value was taken, none, so a later status change or an
  // edit of another answer never collides.
  return typeof stored?.responseKey === "string" ? stored.responseKey : null;
}
