import {
  isDatabaseBusy,
  isDbError,
  type DbErrorKind,
} from "../database/errors";

import {
  NEXTLY_ERROR_STATUS,
  genericPublicMessage,
  type NextlyErrorCode,
} from "./error-codes";
import type {
  PublicData,
  ReleaseNotDeletablePublicData,
  ReleaseProblemsPublicData,
  SharedFieldsConflictPublicData,
  ValidationPublicData,
} from "./public-data";
import { DATABASE_BUSY_RETRY_AFTER_SECONDS } from "./retry-after";

/**
 * Default mapping from DbErrorKind to NextlyError contract. Used by
 * `NextlyError.fromDatabaseError`. Public messages are intentionally generic
 * per spec §13.8 — no DB driver text, no constraint names, no field hints.
 *
 * `satisfies Record<DbErrorKind, ...>` makes the mapping exhaustive at
 * compile time: adding a new DbErrorKind without updating this table is a
 * type error.
 */
const DB_ERROR_MAPPING = {
  "unique-violation": {
    code: "DUPLICATE",
    statusCode: 409,
    publicMessage: "Resource already exists.",
  },
  "fk-violation": {
    code: "VALIDATION_ERROR",
    statusCode: 400,
    publicMessage: "Referenced record does not exist.",
  },
  "not-null-violation": {
    code: "VALIDATION_ERROR",
    statusCode: 400,
    publicMessage: "A required field is missing.",
  },
  constraint: {
    code: "VALIDATION_ERROR",
    statusCode: 400,
    publicMessage: "The provided data violates a constraint.",
  },
  deadlock: {
    code: "CONFLICT",
    statusCode: 409,
    publicMessage: "The operation could not be completed. Please retry.",
  },
  "serialization-failure": {
    code: "CONFLICT",
    statusCode: 409,
    publicMessage: "The operation could not be completed. Please retry.",
  },
  // The statement or transaction that waited never ran; the retry hint says
  // when, and becomes Retry-After on REST.
  busy: {
    code: "DATABASE_BUSY",
    statusCode: NEXTLY_ERROR_STATUS.DATABASE_BUSY,
    publicMessage: genericPublicMessage("DATABASE_BUSY"),
    publicData: { retryAfterSeconds: DATABASE_BUSY_RETRY_AFTER_SECONDS },
  },
  timeout: {
    code: "DATABASE_ERROR",
    statusCode: 500,
    publicMessage: "The operation timed out. Please try again.",
  },
  "connection-lost": {
    code: "DATABASE_ERROR",
    statusCode: 500,
    publicMessage: "A temporary database error occurred. Please try again.",
  },
  syntax: {
    code: "INTERNAL_ERROR",
    statusCode: 500,
    publicMessage: "An unexpected error occurred.",
  },
  internal: {
    code: "INTERNAL_ERROR",
    statusCode: 500,
    publicMessage: "An unexpected error occurred.",
  },
} satisfies Record<
  DbErrorKind,
  {
    code: string;
    statusCode: number;
    publicMessage: string;
    publicData?: PublicData;
  }
>;

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
const NEXTLY_ERROR_BRAND: unique symbol = Symbol.for("nextly/NextlyError");

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

  /**
   * The password was correct and the address is unverified. Thrown only once
   * the password is proven, so only someone who holds it learns the address
   * is unverified; every other refusal stays
   * {@link NextlyError.invalidCredentials}.
   */
  static emailNotVerified(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "EMAIL_NOT_VERIFIED",
      publicMessage:
        "Verify your email address to sign in. Check your inbox for the link.",
      logMessage: "Login refused: email not verified",
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

  /**
   * Distinct from `authRequired`: the caller was authenticated but the
   * session token expired. Clients key on the TOKEN_EXPIRED *code* to
   * silently refresh and retry rather than redirecting to login; the public
   * message stays the generic spec §13.6 string ("Authentication required.")
   * so the wire never reveals the session state — same as `authRequired`.
   */
  static tokenExpired(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "TOKEN_EXPIRED",
      publicMessage: "Authentication required.",
      logContext: opts?.logContext,
    });
  }

  static notFound(opts?: {
    // Declared so a rebuild from a status-only envelope can chain the failure
    // it came from. Without it the option is accepted and dropped whenever it
    // arrives through a spread, which reads as forwarded and is not.
    cause?: Error;
    // A domain-specific message overriding the generic default, for a resource
    // whose absence is answered on more than one surface and has to read the
    // same on each. Mirrors `conflict`: without it a caller reaching the same
    // resource through two entry points is told two different things, and the
    // one that is not this factory wins by having a message at all.
    message?: string;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "NOT_FOUND",
      publicMessage: opts?.message ?? "Not found.",
      cause: opts?.cause,
      logContext: opts?.logContext,
    });
  }

  static forbidden(opts?: {
    cause?: Error;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: "You don't have permission to perform this action.",
      cause: opts?.cause,
      logContext: opts?.logContext,
    });
  }

  /**
   * Something only a signed-in person can do, asked by a caller that is not
   * one: an API key, or a request acting as no person. Forbidden, and the
   * message says so, since it is about what kind of caller asked, not about
   * the caller's permissions. `doing` completes "Only a signed-in person can".
   */
  static personOnly(opts: {
    doing: string;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: `Only a signed-in person can ${opts.doing}.`,
      logContext: opts.logContext,
    });
  }

  /**
   * A role or permission built into Nextly, which is never changed or
   * deleted. Forbidden, and the message says so: it is a fact about the role,
   * not about the caller's permissions.
   */
  static builtIn(opts: {
    thing: "role" | "permission";
    change: "change" | "delete" | "assign" | "inherit";
    logContext?: Record<string, unknown>;
  }): NextlyError {
    const done = {
      change: "changed",
      delete: "deleted",
      assign: "assigned",
      inherit: "inherited",
    }[opts.change];
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: `This ${opts.thing} is built in, so it can't be ${done}.`,
      logContext: opts.logContext,
    });
  }

  /**
   * A request from a site not allowed to make it: its own `Origin` names a
   * site the installation does not allow. Forbidden, and the message says so;
   * the origin is the caller's own, so naming its kind tells them nothing.
   */
  static originRefused(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage:
        "This request came from a site that isn't allowed to make it.",
      logContext: opts?.logContext,
    });
  }

  /**
   * A Single deleted without `force`: Singles hold a site's lasting settings,
   * so they are not deleted from here, only by an admin or CLI clean-up that
   * passes `force`. Forbidden, and the message says so.
   */
  static singleNotDeletable(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: "A Single can't be deleted from here.",
      logContext: opts?.logContext,
    });
  }

  /**
   * A collection, Single or component defined in code, which is changed by
   * changing its code and not from here. Forbidden, and the message says so:
   * it is a fact about the thing, not about the caller's permissions, so it
   * names no permission and no policy. The lock's detail goes to the log
   * through `logContext`.
   */
  static definedInCode(opts: {
    thing: "collection" | "Single" | "component";
    change: "change" | "delete";
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: `This ${opts.thing} is defined in code, so it can't be ${
        opts.change === "change" ? "changed" : "deleted"
      } here.`,
      logContext: opts.logContext,
    });
  }

  /**
   * An autosave where the collection or Single does not autosave: its owner
   * switched autosave off, or it keeps no drafts to autosave into. Forbidden,
   * and the message says so, since it is a setting and not a permission.
   */
  static autosaveOff(opts: {
    scopeKind: string;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "FORBIDDEN",
      publicMessage: `Autosave is turned off for this ${
        opts.scopeKind === "single" ? "Single" : "collection"
      }.`,
      logContext: opts.logContext,
    });
  }

  /**
   * An API key refused because its role allows more than the person creating
   * it may do. The sentence is FORBIDDEN's and names no permission; which one
   * exceeded goes to the log through `logContext`. The code is its own, so a
   * client can tell "choose a smaller role" from plain FORBIDDEN.
   */
  static apiKeyRoleAboveCreator(opts?: {
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "API_KEY_ROLE_ABOVE_CREATOR",
      publicMessage: genericPublicMessage("FORBIDDEN"),
      logContext: opts?.logContext,
    });
  }

  /**
   * A cookie-authenticated write refused because its origin or CSRF token did
   * not check out. The public message names no detail of which check failed;
   * that goes to the log through `logMessage`.
   */
  static csrfFailed(opts?: {
    logMessage?: string;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "CSRF_FAILED",
      publicMessage:
        "This request could not be verified. Reload the page and try again.",
      logMessage: opts?.logMessage,
      logContext: opts?.logContext,
    });
  }

  /**
   * A call the caller got wrong, where naming the mistake IS the value of the
   * error.
   *
   * The only factory that takes its public message from the caller. The
   * generic messages elsewhere exist so an HTTP response cannot leak internal
   * detail; this one is for arguments and configuration a developer controls
   * and must be told about — a missing option, an unusable combination — where
   * `internal()` would reduce the one useful sentence to "An unexpected error
   * occurred." Do not pass user-supplied data through it.
   */
  static invalidInput(opts: {
    message: string;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: opts.message,
      logContext: opts.logContext,
    });
  }

  static validation(opts: {
    errors: ValidationPublicData["errors"];
    cause?: Error;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: { errors: opts.errors },
      cause: opts.cause,
      logContext: opts.logContext,
    });
  }

  static conflict(opts?: {
    reason?: "version" | "state";
    // A domain-specific, actionable message overriding the generic default,
    // for state conflicts where "refresh and try again" would misdirect the
    // caller (a disabled endpoint, an in-flight delivery, and so on).
    message?: string;
    /**
     * What a caller needs to act on the conflict: for a release refused over
     * its documents, the problems by code and member; for a release that
     * cannot be deleted, the reason; for a pending change refused over the
     * fields every language shares, why and which fields.
     */
    data?:
      | ReleaseProblemsPublicData
      | ReleaseNotDeletablePublicData
      | SharedFieldsConflictPublicData;
    cause?: Error;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "CONFLICT",
      publicMessage:
        opts?.message ??
        "The resource has changed since you last loaded it. Please refresh and try again.",
      publicData: opts?.data,
      cause: opts?.cause,
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

  /**
   * A request that waited `pool.connectionTimeoutMs` for a database
   * connection and was given none. The statement or transaction that waited
   * never ran; work committed before it stays committed. The same error
   * `fromDatabaseError` gives a busy DbError, from the same table row.
   */
  static databaseBusy(opts?: {
    cause?: Error;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    const busy = DB_ERROR_MAPPING.busy;
    return new NextlyError({
      code: busy.code,
      statusCode: busy.statusCode,
      publicMessage: busy.publicMessage,
      publicData: busy.publicData,
      cause: opts?.cause,
      logContext: opts?.logContext,
    });
  }

  /**
   * What a request boundary answers with for a thrown value that is not a
   * NextlyError: "database busy" when the request waited out its bound for a
   * connection, which is retryable and no fault of the server's code, and an
   * internal error for anything else.
   *
   * The busy case has to be read here because it usually arrives raw:
   * `withDbErrors` converts only DbErrors, so a driver's error passes through
   * services unconverted to the boundary that answers the request.
   */
  static fromUnexpected(error: unknown): NextlyError {
    return NextlyError.busyOr(error, () =>
      NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
      })
    );
  }

  /**
   * "Database busy" when `error` is a request that waited out its bound for
   * a connection, and `otherwise()` for anything else.
   *
   * For a boundary that answers an unexpected failure with an error of its
   * own choosing rather than an internal one (a 503 for a flow that must not
   * answer on incomplete data), so that a busy database still answers there
   * as it does everywhere else. `fromUnexpected` is this rule with the
   * internal error as its fallback.
   */
  static busyOr(error: unknown, otherwise: () => NextlyError): NextlyError {
    if (!isDatabaseBusy(error)) return otherwise();
    return NextlyError.databaseBusy({
      cause: error instanceof Error ? error : undefined,
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

  /**
   * The app is set up so nextly cannot work: a missing `config`, or a Next.js
   * or React outside the supported ranges. The public message stays generic;
   * what to change goes in `logMessage`, for the operator.
   */
  static configuration(opts: {
    logMessage: string;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "CONFIGURATION_ERROR",
      publicMessage: "Server configuration error.",
      logMessage: opts.logMessage,
      logContext: opts.logContext,
    });
  }

  // Accepts an optional `logMessage` override so callers (e.g. the health
  // route) can record a specific operator narrative ("Health check failed")
  // while the public message stays canonical per spec §13.8.5.
  static serviceUnavailable(opts?: {
    /**
     * What the caller is told, when "try again later" is the wrong advice.
     *
     * The default assumes waiting resolves it. Some causes are not transient —
     * a lock with no expiry is held until an operator clears it — and there the
     * default sends someone to retry a request that cannot start succeeding.
     * Supply a message naming what to DO; it reaches an API response, so it
     * carries a remedy rather than internal state.
     */
    publicMessage?: string;
    logMessage?: string;
    cause?: Error;
    logContext?: Record<string, unknown>;
  }): NextlyError {
    return new NextlyError({
      code: "SERVICE_UNAVAILABLE",
      publicMessage:
        opts?.publicMessage ?? "Service unavailable. Please try again later.",
      logMessage: opts?.logMessage,
      cause: opts?.cause,
      logContext: opts?.logContext,
    });
  }

  /**
   * Convert a DbError (or arbitrary unknown thrown by the DB layer) to a
   * NextlyError with a generic public message and rich logContext. Used by
   * `withDbErrors` for auto-conversion (Pattern A) and by services that
   * catch DB errors at boundaries (Pattern B). Spec §8.2 mapping table.
   *
   * Never leaks DB driver text, constraint names, or table names into
   * `publicMessage`. All DB context goes into `logContext`. The original
   * DbError is preserved as `cause`.
   */
  static fromDatabaseError(error: unknown): NextlyError {
    if (isDbError(error)) {
      // DB_ERROR_MAPPING is exhaustive over DbErrorKind via `satisfies` so
      // this lookup always succeeds at compile time.
      const mapping = DB_ERROR_MAPPING[error.kind];
      // Build logContext conditionally so log lines aren't cluttered with
      // `undefined` keys for absent fields.
      const logContext: Record<string, unknown> = {
        dbKind: error.kind,
        dialect: error.dialect,
      };
      // DbError.code is the dialect-specific code (SQLSTATE, errno, etc.) —
      // not an actual constraint name. Surface it as `dbCode` so operators
      // know what they're reading. Constraint-name-to-field mapping is
      // per-call-site (§8.6).
      if (error.code !== undefined) logContext.dbCode = error.code;
      if (error.meta !== undefined) logContext.meta = error.meta;

      return new NextlyError({
        code: mapping.code,
        statusCode: mapping.statusCode,
        publicMessage: mapping.publicMessage,
        publicData: "publicData" in mapping ? mapping.publicData : undefined,
        logMessage: "Database error",
        logContext,
        cause: error,
      });
    }

    // Non-DbError fallback: wrap as INTERNAL_ERROR and preserve cause when
    // it is an Error. Non-Error values (strings, numbers) flow through
    // without a cause but still get the generic public message.
    return new NextlyError({
      code: "INTERNAL_ERROR",
      statusCode: 500,
      publicMessage: "An unexpected error occurred.",
      logMessage: "Non-DbError passed to fromDatabaseError",
      cause: error instanceof Error ? error : undefined,
      logContext: error instanceof Error ? undefined : { value: String(error) },
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
