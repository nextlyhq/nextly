/**
 * Structured public payloads attached to NextlyError instances.
 *
 * `publicData` lives in HTTP response bodies and Server Action results.
 * It is safe by construction — never contains rejected values, identifiers
 * the caller didn't already provide, or operator-only context.
 */

export type ValidationPublicData = {
  errors: Array<{
    /** Dotted/bracketed path: "user.email", "items[2].quantity" */
    path: string;
    /** Stable machine code: "INVALID_FORMAT" | "REQUIRED" | "TOO_LOW" | ... */
    code: string;
    /** Complete sentence, ends with a period: "Must be a valid email address." */
    message: string;
  }>;
};

/**
 * A retry hint: how many seconds the caller waits before sending the request
 * again. Carried by RATE_LIMITED and DATABASE_BUSY, and sent on REST as the
 * Retry-After header (`retryAfterSeconds` in `errors/retry-after.ts`).
 */
export type RateLimitPublicData = {
  retryAfterSeconds?: number;
};

/**
 * Which Single a `NOT_FOUND` from the singles read is ABOUT.
 *
 * The slug the caller named, and nothing more: a Single that is not registered
 * and one holding no document the caller's status view may see answer with
 * the same payload, so neither becomes distinguishable from the other. What it
 * distinguishes is the read's own refusal from a `NOT_FOUND` a hook or a
 * related read raised for something else -- which a caller reading the Single
 * on behalf of a card has to tell apart, one being an empty card and the other
 * a failed one.
 */
export type SingleAbsentPublicData = {
  single: string;
};

/**
 * Why a content release cannot be deleted, for a client to say so in its own
 * words: `published` (the record of what went live), `committed` (scheduled
 * or stopped; cancel it first) or `was-scheduled` (cancelled after it was
 * scheduled, so it may have run and is kept).
 *
 * @experimental
 */
export type ReleaseNotDeletablePublicData = {
  reason: "published" | "committed" | "was-scheduled";
};

/**
 * The problems a release refusal names: each a code a client renders, and the
 * member it is about — `null` for a document the refused change had not yet
 * written. Codes and member ids only, never the documents' content.
 */
export type ReleaseProblemsPublicData = {
  problems: Array<{ memberId: string | null; code: string }>;
};

export type PublicData =
  | ValidationPublicData
  | ReleaseNotDeletablePublicData
  | RateLimitPublicData
  | SingleAbsentPublicData
  | ReleaseProblemsPublicData
  | undefined;
