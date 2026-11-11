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

/** The answer to `field` in a submission's data. */
function answerOf(data: unknown, field: string | undefined): unknown {
  if (field === undefined || data === null || typeof data !== "object") {
    return undefined;
  }
  return (data as Record<string, unknown>)[field];
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
