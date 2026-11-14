import { z } from "zod";

import { consoleLogger } from "../types";

import { DEFAULT_DIALECT, DIALECTS, dialectFromUrl } from "./stated-dialect";

// Zod v4 schema for environment variables with conditional validation
// for production and database dialects.
// The dialects, and how a connection URL implies one, live in a module that
// imports nothing, so code that runs while Next.js loads `next.config` reads
// the environment's dialect by the same rule; re-exported where callers have
// always found `dialectFromUrl`.
export { dialectFromUrl };

/**
 * Fill in the dialect the operator did not state.
 *
 * DB_DIALECT used to carry a Zod default, so it was never absent, so the
 * factory's URL fallback behind it was unreachable: an operator who set only
 * `DATABASE_URL=mysql://...`, which the adapter READMEs say is enough, got a
 * PostgreSQL adapter, PostgreSQL identifier quoting and the PostgreSQL schema
 * tables, because all three read this one value.
 *
 * Done here, before the object parses, rather than at each call site, so both
 * entry points get it and the rule is stated once. An explicit value always
 * wins; an empty string counts as unstated, which is how the factory's own
 * truthiness check treated it.
 */
function withResolvedDialect(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const source = raw as Record<string, unknown>;
  if (source.DB_DIALECT) return source;
  // An empty DB_DIALECT is unstated, so it must not reach the enum: leaving it
  // in place made `DB_DIALECT=""` with a URL implying nothing fail validation
  // rather than take the PostgreSQL default, which contradicts the rule stated
  // just above. Removed whether or not the URL supplies a replacement.
  const { DB_DIALECT: _unstated, ...rest } = source;
  const implied = dialectFromUrl(source.DATABASE_URL);
  return implied ? { ...rest, DB_DIALECT: implied } : rest;
}

/**
 * The pool and timeout settings, a schema of their own so the database factory can read them
 * without validating the rest of the environment: a command that names its database hands the
 * factory its dialect and URL, and the environment's own database target, absent or not, is then
 * none of the factory's business. The full schema below spreads these in, so both read the keys
 * by one definition.
 */
const _poolSettingsObject = z.object({
  // These used to carry zod defaults, but the defaults silently overrode the adapter's
  // intentional cold-start-friendly defaults (e.g. the Postgres adapter's `min: 0` for Neon
  // auto-suspend recovery, in packages/adapter-postgres/src/index.ts). They are optional so the
  // factory's `??` chain falls through to adapter-level defaults when the operator has set
  // nothing.
  DB_POOL_MAX: z.coerce.number().int().min(1).optional(),
  DB_POOL_MIN: z.coerce.number().int().min(0).optional(),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().int().min(1000).optional(),
  DB_QUERY_TIMEOUT: z.coerce.number().int().min(1000).optional(),
});

export type PoolSettings = z.infer<typeof _poolSettingsObject>;

/**
 * Log each problem the environment validation found, naming its key, and refuse to go on. The one
 * refusal both the full validation and the pool settings' own read give, so they say the same thing.
 */
function refuseInvalidEnv(error: z.ZodError): never {
  consoleLogger.error("Environment validation failed");
  error.issues.forEach(issue => {
    consoleLogger.error(`  ${issue.path.join(".")}: ${issue.message}`);
  });
  throw new Error("Invalid environment configuration");
}

/**
 * The pool and timeout settings in `source`, validated alone. A value out of range is refused as
 * the full validation refuses it, naming the key.
 */
export function readPoolSettings(
  source: Record<string, unknown> = process.env
): PoolSettings {
  const parsed = _poolSettingsObject.safeParse(source);
  if (!parsed.success) refuseInvalidEnv(parsed.error);
  return parsed.data;
}

const _envObject = z
  .object({
    // Runtime
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    // Database
    DB_DIALECT: z.enum(DIALECTS).default(DEFAULT_DIALECT),
    // Optional by default to allow sqlite file paths; validated conditionally below
    DATABASE_URL: z.string().optional(),
    // SQLite-specific path (alternative to DATABASE_URL for SQLite)
    SQLITE_PATH: z.string().optional(),
    // Pooling & timeouts, defined once (`_poolSettingsObject`).
    ..._poolSettingsObject.shape,
    DB_HEALTHCHECK_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(30000),
    DB_SNAKE_CASE: z.coerce.boolean().default(false),

    // URLs
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    API_BASE_URL: z.string().url().default("http://localhost:3000/api"),

    // Nextly auth secret (required in production, min 32 chars)
    NEXTLY_SECRET: z.string().optional(),
    // Secrets this install has RETIRED, newest first.
    //
    // Rotating `NEXTLY_SECRET` re-keys every value derived from it, which
    // silently orphans data written under the old one: an email delivery row's
    // recipient digest stops matching, so an erasure request computes a value
    // none of the older rows carry and reports success having matched nothing.
    // Listing a retired secret here keeps those rows REACHABLE for erasure
    // without making them writable — nothing new is ever keyed with one.
    //
    // Two spellings, because one of them cannot express every legal secret.
    // The ordinary form is comma-separated and reads plainly in a `.env`:
    //
    //   NEXTLY_SECRET_PREVIOUS=older,oldest
    //
    // A secret containing a comma, or one whose leading or trailing whitespace
    // is part of the key, needs the JSON form — splitting or trimming those
    // produces a key that was never used, which matches nothing and fails in
    // the silent direction:
    //
    //   NEXTLY_SECRET_PREVIOUS=["old,with,commas","  spaced  "]
    //
    // The JSON form also expresses two generations the comma form cannot name
    // at all, and both are reachable:
    //
    //   NEXTLY_SECRET_PREVIOUS=[null,""]
    //
    // `null` is the UNKEYED generation — what a development install writes
    // before it has a secret. Those rows carry a plain SHA-256 digest that no
    // HMAC reproduces, so enabling a secret later strands them unless that
    // generation can still be named. `""` is a secret that really was the
    // empty string, which the writer uses as an HMAC key like any other.
    //
    // An empty entry in the COMMA form is dropped, because there it is a
    // trailing comma rather than a declaration. In the JSON form it is kept:
    // writing it is deliberate.
    NEXTLY_SECRET_PREVIOUS: z.string().optional(),
    // Shared secret a scheduler (e.g. Vercel Cron) presents to the webhook
    // drain route. Optional: when unset, the drain route can still be triggered
    // by an authenticated admin/API-key call, but unattended cron triggering is
    // disabled. When set it must be >= 32 chars (like NEXTLY_SECRET): it
    // independently authorizes a public trigger, so a short/guessable value —
    // and the empty string, which would silently disable the cron path — is
    // rejected at boot rather than accepted. Compared in constant time.
    NEXTLY_DRAIN_SECRET: z.string().min(32).optional(),
    // Vercel Cron's convention: the platform sends the project's `CRON_SECRET`
    // as the bearer token on scheduled invocations. Accepted as an alternative
    // drain secret. Deliberately NOT length-constrained here: `CRON_SECRET` is a
    // platform-wide variable that may already be set (possibly short) for other
    // cron routes, so enforcing a length in the global env schema would fail boot
    // for deployments that don't even use the webhook drain. The entropy floor is
    // enforced at the drain-auth boundary instead: a `CRON_SECRET` shorter than
    // the required length is simply not accepted as a drain secret.
    CRON_SECRET: z.string().optional(),
    // Additional allowed origins for CSRF validation (comma-separated)
    NEXTLY_ALLOWED_ORIGINS: z.string().optional(),

    // SMTP (Email provider)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().email().optional(),
  })
  .superRefine((val, ctx) => {
    const isProd = val.NODE_ENV === "production";

    // A CRON_SECRET too short to authorize the drain is ignored at the auth
    // boundary rather than rejected here (it is a platform-wide variable and
    // must not fail app boot for deployments that don't use the drain). Warn so
    // an operator who set it FOR the drain gets a signal instead of silent 403s.
    // `!== undefined` (not truthiness) so an explicit empty string — which also
    // fails the auth-boundary length gate — still produces the warning.
    if (val.CRON_SECRET !== undefined && val.CRON_SECRET.length < 32) {
      consoleLogger.warn(
        "⚠️  CRON_SECRET is shorter than 32 characters and will NOT be accepted " +
          "as a webhook drain secret. Use a >= 32-char value (or NEXTLY_DRAIN_SECRET) " +
          "if you rely on the webhooks drain route to authorize scheduled runs."
      );
    }

    // Production hard requirements
    if (isProd) {
      if (!val.NEXTLY_SECRET || val.NEXTLY_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NEXTLY_SECRET"],
          message:
            "In production, NEXTLY_SECRET of at least 32 characters is required.",
        });
      }
      if (!val.NEXT_PUBLIC_APP_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NEXT_PUBLIC_APP_URL"],
          message: "In production, NEXT_PUBLIC_APP_URL is required.",
        });
      }

      // In production, only require full SMTP configuration if any SMTP variable is provided
      const anySmtpProvided = Boolean(
        val.SMTP_HOST || val.SMTP_USER || val.SMTP_PASS || val.SMTP_FROM
      );
      if (anySmtpProvided) {
        const missingSmtp =
          !val.SMTP_HOST || !val.SMTP_USER || !val.SMTP_PASS || !val.SMTP_FROM;
        if (missingSmtp) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["SMTP_FROM"],
            message:
              "SMTP configuration is partially provided. When using Email in production, set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM.",
          });
        }
      }
    }

    // DATABASE_URL is required for PostgreSQL and MySQL, optional for SQLite
    const dialect = val.DB_DIALECT;
    if (dialect !== "sqlite") {
      // PostgreSQL and MySQL require DATABASE_URL
      if (!val.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message: `DATABASE_URL is required for ${dialect} dialect.`,
        });
      }
    }

    // Validate DATABASE_URL format if provided
    if (val.DATABASE_URL) {
      try {
        new URL(val.DATABASE_URL);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message: "DATABASE_URL must be a valid URL.",
        });
      }
    }

    // For SQLite, at least one of DATABASE_URL or SQLITE_PATH should be provided
    // (factory defaults to file:./data/nextly.db if neither is set)
    if (dialect === "sqlite" && !val.DATABASE_URL && !val.SQLITE_PATH) {
      // Only warn in development, don't error (factory has default)
      if (!isProd) {
        consoleLogger.warn(
          "⚠️  Neither DATABASE_URL nor SQLITE_PATH set for SQLite. " +
            "Defaulting to file:./data/nextly.db"
        );
      }
    }
  });

/**
 * The schema, with the dialect resolved before anything reads it.
 *
 * Wrapping rather than resolving at each call site keeps the rule in one place:
 * `validateEnv` and `validateEnvObject` both parse through here, and the
 * conditional checks above see the resolved dialect rather than an absent one,
 * so their messages still name a real dialect.
 */
export const _envSchema = z.preprocess(withResolvedDialect, _envObject);

export type BaseEnv = z.infer<typeof _envSchema>;
export type Env = BaseEnv & {
  // Parsed allowed origins array from comma-separated NEXTLY_ALLOWED_ORIGINS
  NEXTLY_ALLOWED_ORIGINS_PARSED: string[];
};

function validateEnv(): Env {
  const parsed = _envSchema.safeParse(process.env);
  if (!parsed.success) refuseInvalidEnv(parsed.error);

  const data = parsed.data;

  // Parse allowed origins from comma-separated string
  const allowedOrigins = data.NEXTLY_ALLOWED_ORIGINS
    ? data.NEXTLY_ALLOWED_ORIGINS.split(",")
        .map(s => s.trim())
        .filter(Boolean)
    : [];

  const normalized: Env = Object.freeze({
    ...data,
    NEXTLY_ALLOWED_ORIGINS_PARSED: allowedOrigins,
  });

  return normalized;
}

// Lazy-initialised env: the proxy defers validateEnv() until a property is
// first read. This is critical for ESM because static imports are fully
// resolved *before* the importing module's body runs. Without lazy init the
// CLI's dotenv.config() call (or Next.js's built-in .env loading) would not
// yet have populated process.env when this module evaluates, causing a
// spurious "DATABASE_URL is required" error.
let _cachedEnv: Env | null = null;

function getValidatedEnv(): Env {
  if (!_cachedEnv) {
    _cachedEnv = validateEnv();
  }
  return _cachedEnv;
}

export const env: Readonly<Env> = new Proxy({} as Env, {
  get(_, prop, receiver) {
    return Reflect.get(getValidatedEnv(), prop, receiver);
  },
  has(_, prop) {
    return Reflect.has(getValidatedEnv(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getValidatedEnv());
  },
  getOwnPropertyDescriptor(_, prop) {
    return Reflect.getOwnPropertyDescriptor(getValidatedEnv(), prop);
  },
});

/**
 * Discard the validated environment so the next read re-reads `process.env`.
 *
 * The cache above exists because validation must not run at import time, and
 * in an application the environment is fixed once the process starts — so
 * nothing in production ever needs this. A test process is the exception: the
 * integration harness boots one instance per dialect in a single process, and
 * without this the first boot would freeze `DB_DIALECT` for every boot after
 * it. Consumers that read the dialect through this proxy — the boolean
 * conversion in `toDialectBool`, the schema services' fallback — would then
 * keep answering for a database nobody is connected to any more.
 *
 * @internal
 */
export function _resetEnvCache(): void {
  _cachedEnv = null;
}

// Exposed helper for testing and tooling scenarios where a specific object of
// variables should be validated instead of process.env.
export function validateEnvObject(obj: Record<string, unknown>): Env {
  const parsed = _envSchema.safeParse(obj);
  if (!parsed.success) {
    throw parsed.error;
  }
  const data = parsed.data;
  const allowedOrigins = data.NEXTLY_ALLOWED_ORIGINS
    ? data.NEXTLY_ALLOWED_ORIGINS.split(",")
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  return Object.freeze({
    ...data,
    NEXTLY_ALLOWED_ORIGINS_PARSED: allowedOrigins,
  });
}
