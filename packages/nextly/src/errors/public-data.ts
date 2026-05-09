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

export type RateLimitPublicData = {
  retryAfterSeconds?: number;
};

export type PublicData = ValidationPublicData | RateLimitPublicData | undefined;
