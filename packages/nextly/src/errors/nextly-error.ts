import { NEXTLY_ERROR_STATUS, type NextlyErrorCode } from "./error-codes";
import type { PublicData, ValidationPublicData } from "./public-data";

/**
 * Code accepted by NextlyError: canonical codes get autocomplete, but plugin
 * authors may use any UPPER_SNAKE string. The `(string & {})` trick preserves
 * the literal union for IntelliSense without collapsing to plain `string`.
 */
export type NextlyErrorCodeLike = NextlyErrorCode | (string & {});

type NextlyErrorOpts = {
  code: NextlyErrorCodeLike;
  publicMessage: string;
  publicData?: PublicData;
  messageKey?: string;
  logMessage?: string;
  logContext?: Record<string, unknown>;
  statusCode?: number;
  cause?: Error;
};

export type NextlyErrorResponseJSON = {
  code: string;
  message: string;
  messageKey?: string;
  data?: PublicData;
  requestId: string;
};

// Cross-realm brand so NextlyError.is identifies instances structurally,
// surviving package-boundary mismatches (multiple bundled copies, plugin
// bundles, etc.). Symbol.for shares the symbol across module instances via
// the global registry. Inheritance (e.g., legacy direct-api NotFoundError
// extends NextlyError) propagates the brand through the prototype chain.
const NEXTLY_ERROR_BRAND: unique symbol = Symbol.for(
  "@revnixhq/nextly/NextlyError"
);

function hasBrand(value: unknown): boolean {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return (value as Record<symbol, unknown>)[NEXTLY_ERROR_BRAND] === true;
}

/**
 * Unified error class for Nextly. Used at every throw site across services,
 * direct API, auth, and plugins. Carries two distinct payloads:
 *
 *   - Public  (`code`, `publicMessage`, `publicData`, `statusCode`, `messageKey`)
 *     sent in HTTP responses and Server Action results.
 *   - Log     (`logMessage`, `logContext`, `cause`, stack trace)
 *     written to the server logger; never serialised to the wire.
 *
 * Use the static factories (notFound, forbidden, validation, ...) for the
 * common cases. Use the free-form constructor for plugin codes or one-off
 * shapes.
 */
export class NextlyError extends Error {
  readonly code: NextlyErrorCodeLike;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly publicData?: PublicData;
  readonly messageKey?: string;
  readonly logMessage?: string;
  readonly logContext?: Record<string, unknown>;
  override readonly cause?: Error;
  readonly timestamp: Date;

  constructor(opts: NextlyErrorOpts) {
    // Use publicMessage as Error.message — purely for stack-trace ergonomics.
    // It is never read off Error.message in serialisation; toResponseJSON and
    // toLogJSON are the only paths to the wire and the log.
    super(opts.publicMessage);
    this.name = "NextlyError";
    this.code = opts.code;
    this.publicMessage = opts.publicMessage;
    this.publicData = opts.publicData;
    this.messageKey = opts.messageKey;
    this.logMessage = opts.logMessage;
    this.logContext = opts.logContext;
    // useDefineForClassFields (ES2022 default) resets values set by super(),
    // so we cast to bypass the readonly modifier and assign after super().
    (this as { cause?: Error }).cause = opts.cause;
    this.timestamp = new Date();
    this.statusCode = NextlyError.resolveStatusCode(opts);

    // Maintain proper stack trace in V8 environments.
    Error.captureStackTrace?.(this, NextlyError);
  }

  // Stamp the brand on the prototype so all instances (including subclass
  // instances during the migration shim) carry it via inheritance.
  static {
    (NextlyError.prototype as unknown as Record<symbol, unknown>)[
      NEXTLY_ERROR_BRAND
    ] = true;
  }

  private static resolveStatusCode(opts: NextlyErrorOpts): number {
    if (typeof opts.statusCode === "number") return opts.statusCode;
    if (opts.code in NEXTLY_ERROR_STATUS) {
      return NEXTLY_ERROR_STATUS[opts.code as NextlyErrorCode];
    }
    return 500;
  }

  /** HTTP-safe JSON. Strips logMessage / logContext / cause / stack. */
  toResponseJSON(requestId: string): NextlyErrorResponseJSON {
    const json: NextlyErrorResponseJSON = {
      code: String(this.code),
      message: this.publicMessage,
      requestId,
    };
    if (this.messageKey) json.messageKey = this.messageKey;
    if (this.publicData !== undefined) json.data = this.publicData;
    return json;
  }

  /** Operator-facing JSON for log lines. Includes everything. */
  toLogJSON(requestId: string): Record<string, unknown> {
    return {
      code: this.code,
      statusCode: this.statusCode,
      publicMessage: this.publicMessage,
      messageKey: this.messageKey,
      logMessage: this.logMessage,
      logContext: this.logContext,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
            stack: this.cause.stack,
          }
        : undefined,
      timestamp: this.timestamp.toISOString(),
      requestId,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Static factories — the recommended throw site for every common case.
  // Public messages here follow the §13.8 rubric: complete sentence,
  // generic, no identifiers, no value echoing, no policy hints.
  // ────────────────────────────────────────────────────────────────────

  static invalidCredentials(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "AUTH_INVALID_CREDENTIALS",
      publicMessage: "Invalid email or password.",
      logMessage: "Login failed",
      logContext: opts?.logContext,
    });
  }

  static authRequired(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "AUTH_REQUIRED",
      publicMessage: "Authentication required.",
      logContext: opts?.logContext,
    });
  }

  static notFound(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "NOT_FOUND",
      publicMessage: "Not found.",
      logContext: opts?.logContext,
    });
  }

  static forbidden(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: "You don't have permission to perform this action.",
      logContext: opts?.logContext,
    });
  }

  static validation(opts: {
    errors: ValidationPublicData["errors"];
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: { errors: opts.errors },
      logContext: opts.logContext,
    });
  }

  static conflict(opts?: {
    reason?: "version" | "state";
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "CONFLICT",
      publicMessage:
        "The resource has changed since you last loaded it. Please refresh and try again.",
      logContext: { reason: opts?.reason, ...opts?.logContext },
    });
  }

  static duplicate(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "DUPLICATE",
      publicMessage: "Resource already exists.",
      logContext: opts?.logContext,
    });
  }

  static rateLimited(opts?: {
    retryAfterSeconds?: number;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "RATE_LIMITED",
      publicMessage: "Too many requests. Please try again later.",
      publicData:
        opts?.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: opts.retryAfterSeconds }
          : undefined,
      logContext: opts?.logContext,
    });
  }

  static internal(opts?: {
    cause?: Error;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      cause: opts?.cause,
      logContext: opts?.logContext,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Type guards. Structural rather than `instanceof` so they survive
  // package-boundary mismatches (one consumer's NextlyError is a
  // different module instance from another's).
  // ────────────────────────────────────────────────────────────────────

  static is(err: unknown): err is NextlyError {
    return hasBrand(err);
  }

  static isCode(err: unknown, code: NextlyErrorCodeLike): err is NextlyError {
    return hasBrand(err) && (err as NextlyError).code === code;
  }

  static isNotFound(err: unknown): err is NextlyError {
    return NextlyError.isCode(err, "NOT_FOUND");
  }

  static isValidation(err: unknown): err is NextlyError {
    return NextlyError.isCode(err, "VALIDATION_ERROR");
  }

  static isAuthRequired(err: unknown): err is NextlyError {
    return NextlyError.isCode(err, "AUTH_REQUIRED");
  }

  static isForbidden(err: unknown): err is NextlyError {
    return NextlyError.isCode(err, "FORBIDDEN");
  }

  static isConflict(err: unknown): err is NextlyError {
    return NextlyError.isCode(err, "CONFLICT");
  }

  static isRateLimited(err: unknown): err is NextlyError {
    return NextlyError.isCode(err, "RATE_LIMITED");
  }
}
