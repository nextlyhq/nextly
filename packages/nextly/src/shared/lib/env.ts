import { z } from "zod";

// Zod v4 schema for environment variables with conditional validation
// for production and database dialects.
export const _envSchema = z
  .object({
    // Runtime
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    // Database
    DB_DIALECT: z.enum(["postgresql", "mysql", "sqlite"]).default("postgresql"),
    // Optional by default to allow sqlite file paths; validated conditionally below
    DATABASE_URL: z.string().optional(),
    // SQLite-specific path (alternative to DATABASE_URL for SQLite)
    SQLITE_PATH: z.string().optional(),
    // Pooling & timeouts
    DB_POOL_MAX: z.coerce.number().int().min(1).default(20),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DB_POOL_IDLE_TIMEOUT: z.coerce.number().int().min(1000).default(30000),
    DB_QUERY_TIMEOUT: z.coerce.number().int().min(1000).default(15000),
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
        console.warn(
          "⚠️  Neither DATABASE_URL nor SQLITE_PATH set for SQLite. " +
            "Defaulting to file:./data/nextly.db"
        );
      }
    }
  });

export type BaseEnv = z.infer<typeof _envSchema>;
export type Env = BaseEnv & {
  // Parsed allowed origins array from comma-separated NEXTLY_ALLOWED_ORIGINS
  NEXTLY_ALLOWED_ORIGINS_PARSED: string[];
};

function validateEnv(): Env {
  const parsed = _envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Environment validation failed:");
    parsed.error.issues.forEach(issue => {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    });
    throw new Error("Invalid environment configuration");
  }

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
