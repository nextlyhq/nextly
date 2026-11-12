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
import { z } from "zod";

import type { FormSettings } from "../types";

/** What a visitor sending a second response is told. */
export const ALREADY_RESPONDED = "You have already submitted this form.";

type Digests = PluginContext["security"]["digests"];

/**
 * The answer a visitor's browser sends its token in, for a form that takes
 * one response per browser. The form's script keeps one random token per
 * browser and sends it with every submission; the row never stores it.
 */
export const BROWSER_TOKEN_FIELD = "nextly-browser-token";

/**
 * What every browser key starts with. The token is not stored, so a browser
 * key cannot be made again from the row the way an address's can; the prefix
 * is what lets the submission's hold tell a key made for one per browser from
 * one made for another mode, and refuse it once the form's mode has changed.
 * Digests are hex, so no address or network key can start with it.
 */
const BROWSER_KEY_PREFIX = "browser:";

/**
 * A browser token as the form's script makes one: a random identifier
 * (`crypto.randomUUID()` is one), letters, digits, `-` and `_`. Anything else
 * is treated as no token, so a malformed value can neither be stored as a
 * key nor fill the index with arbitrary text.
 */
const BROWSER_TOKEN = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,128}$/);

/** The browser token a submission's answers carry, if a well-formed one. */
export function browserTokenOf(payload: unknown): string | undefined {
  const parsed = BROWSER_TOKEN.safeParse(
    answersOf(payload)?.[BROWSER_TOKEN_FIELD]
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * What a visitor's form needs to take part in one response per browser: the
 * answer to send its token in. Other modes need nothing from the browser, and
 * a form that does not compare by browser says nothing.
 */
export function publicOneResponse(
  settings: Pick<FormSettings, "oneResponse">
): { by: "browser"; field: string } | undefined {
  return settings.oneResponse === "browser"
    ? { by: "browser", field: BROWSER_TOKEN_FIELD }
    : undefined;
}

/** Whether `key` was made for one response per browser. */
function isBrowserKey(key: unknown): key is string {
  return typeof key === "string" && key.startsWith(BROWSER_KEY_PREFIX);
}

/** The parts of a submission its key is made from. */
export interface KeyedSubmission {
  status?: unknown;
  ipAddress?: unknown;
  data?: unknown;
  /**
   * The browser token the submission came with (`browserTokenOf`). Only a
   * create has one: the row does not keep it.
   */
  browserToken?: string;
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
 * or what the mode compares is missing (a submission with no address, or
 * none of the browser token, which only a create brings).
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
    case "browser": {
      const token = submission.browserToken;
      return token === undefined
        ? null
        : `${BROWSER_KEY_PREFIX}${await digests().digest("browser", token)}`;
    }
    default:
      return null;
  }
}

/**
 * Whether the key a new submission was given is the one `settings` give it.
 * An address's key is made again from the row and compared. A browser's
 * cannot be, since its token is not stored: under one per browser a browser
 * key, or none (a submission sent without a token), is the right one, and a
 * key made for another mode is not.
 */
export async function holdsKeyFor(
  digests: () => Digests,
  settings: Pick<FormSettings, "oneResponse" | "oneResponseField">,
  row: KeyedSubmission & { responseKey?: unknown }
): Promise<boolean> {
  const key = row.responseKey ?? null;
  if (settings.oneResponse === "browser" && row.status !== "spam") {
    return key === null || isBrowserKey(key);
  }
  return key === (await responseKeyOf(digests, settings, row));
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
  if (input.settings.oneResponse === "browser") {
    return browserKeyAfterUpdate(patch, stored);
  }
  // What the update leaves out is as stored; what it clears (null) is gone.
  const after = (field: keyof KeyedSubmission) =>
    patch[field] === undefined ? stored?.[field] : patch[field];
  const key = await responseKeyOf(input.digests, input.settings, {
    status: after("status"),
    data: after("data"),
    ipAddress: after("ipAddress"),
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

/**
 * A submission's browser key after an update. The token is not stored, so
 * the key cannot be made again: the submission keeps the browser key it
 * holds until it is marked spam, which gives the browser its place back, and
 * one restored from spam stays without one. Answers edited or the
 * submission moved to another form taking one per browser keep it, since it
 * is the same browser's response; the unique index refuses a move onto a form
 * where that browser has responded already.
 */
function browserKeyAfterUpdate(
  patch: KeyedSubmission,
  stored: (KeyedSubmission & { responseKey?: unknown }) | undefined
): string | null {
  const status = patch.status === undefined ? stored?.status : patch.status;
  if (status === "spam") return null;
  const key = stored?.responseKey;
  return isBrowserKey(key) ? key : null;
}
