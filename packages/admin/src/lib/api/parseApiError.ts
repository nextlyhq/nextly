/**
 * Shared API Error Parser
 *
 * Reads the canonical wire shape (per spec §10.1):
 *   { error: { code, message, data?, requestId } }
 *
 * Anything else falls through to a generic UNKNOWN error.
 */

export interface ApiError extends Error {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function parseApiError(json: unknown, status: number): ApiError {
  if (
    isObject(json) &&
    isObject(json.error) &&
    typeof json.error.code === "string" &&
    typeof json.error.message === "string"
  ) {
    const error = new Error(json.error.message) as ApiError;
    error.status = status;
    error.code = json.error.code;
    error.data = isObject(json.error.data) ? json.error.data : undefined;
    error.requestId =
      typeof json.error.requestId === "string"
        ? json.error.requestId
        : undefined;
    return error;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("Non-canonical error response", json);
  }

  const error = new Error("Unexpected response from server.") as ApiError;
  error.status = status;
  error.code = "UNKNOWN";
  return error;
}

/**
 * One field's complaint, as the validation envelope carries it.
 *
 * Every field is optional because this describes a body that has crossed a
 * network. The server's own `ValidationPublicData` requires all three, but
 * nothing on this side of the transport can enforce that, and a consumer
 * reading `path` off an entry that carries none is the defect this shape exists
 * to make visible.
 */
export interface ValidationIssue {
  /** Dotted or bracketed path to the field: `breakpoints`, `items[2].quantity`. */
  readonly path?: string;
  /** Stable machine code: `REQUIRED`, `INVALID_FORMAT`. */
  readonly code?: string;
  /** A complete sentence, ready to show someone. */
  readonly message?: string;
}

/**
 * Whether a caught value is the structured error this module raises.
 *
 * A guard rather than a cast because a rejection is NOT always one. `fetcher`
 * awaits `fetch` without wrapping it, so an offline, DNS or CORS failure
 * rejects with the native `TypeError` and never reaches `parseApiError`. That
 * value carries no `status`, so anything reading one off a rejection has to ask
 * first — and a cast would answer yes for both.
 *
 * Keyed on `status` being a NUMBER rather than merely present, because the
 * absent-status case is the one this exists to separate.
 */
export function isApiError(reason: unknown): reason is ApiError {
  return (
    reason instanceof Error &&
    typeof (reason as Partial<ApiError>).status === "number"
  );
}

/**
 * The per-field complaints a rejection carries, or none.
 *
 * The one reading of `data.errors`, so a consumer keying by field and a
 * consumer showing a sentence agree about what is in there. Each applies its
 * own requirement to the result — which fields it needs present — rather than
 * restating how to find them.
 *
 * Empty for every rejection that is not a validation failure, a transport
 * error included, which is why this answers with an array rather than a
 * nullable: there is no reading in which "no issues" and "not that kind of
 * error" need different handling.
 */
export function validationIssues(reason: unknown): readonly ValidationIssue[] {
  if (!isApiError(reason)) return [];

  const errors = reason.data?.errors;
  if (!Array.isArray(errors)) return [];

  // Rebuilt field by field rather than asserted, because this is the point the
  // wire shape becomes a typed one. Anything the server sent that is not a
  // string arrives here as `undefined`, which every caller already handles.
  return errors.filter(isObject).map(issue => ({
    path: typeof issue.path === "string" ? issue.path : undefined,
    code: typeof issue.code === "string" ? issue.code : undefined,
    message: typeof issue.message === "string" ? issue.message : undefined,
  }));
}

/**
 * What to show a person for a failed request.
 *
 * A validation failure's `message` is "Validation failed.", which is true and
 * useless — the reasons are per-field, in `data.errors`. Reading the top-level
 * message alone tells someone their form was rejected without saying by what,
 * so the field messages come out in front where a reader will look.
 *
 * `fallback` is what a caller shows when the error carries no message at all;
 * it defaults to the generic string, so the existing callers are unchanged.
 * Screens pass their own copy rather than restating this default.
 */
export function apiErrorMessage(
  err: unknown,
  fallback = "An error occurred"
): string {
  // Read through the shared extractor, so this and a caller keying issues by
  // field cannot disagree about where the reasons live. What differs between
  // them is the requirement, not the lookup: this one needs a message and does
  // not care which field produced it.
  const reasons = validationIssues(err)
    .map(issue => issue.message)
    .filter((m): m is string => m !== undefined && m.length > 0);

  if (reasons.length > 0) return reasons.join(" ");

  if (!(err instanceof Error)) return fallback;

  return err.message || fallback;
}
