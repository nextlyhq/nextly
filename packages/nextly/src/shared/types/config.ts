/**
 * Nextly Config Types
 *
 * Canonical home for the public Nextly configuration interfaces and the
 * pure sanitization helper that fills in defaults. User-facing modules
 * like `src/collections/config/define-config.ts` re-export these types
 * and delegate the "fill defaults" step to `sanitizeConfig()`.
 *
 * @module shared/types/config
 * @since 1.0.0
 */

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { CorsConfig } from "../../middleware/cors";
import type { RateLimitStore } from "../../middleware/rate-limit";
import type { SecurityHeadersConfig } from "../../middleware/security-headers";
import type { AdminPlacement } from "../../plugins/admin-placement";
import type {
  PluginAdminAppearance,
  PluginDefinition,
} from "../../plugins/plugin-context";
import type {
  SanitizationConfigInput,
  UploadSecurityConfigInput,
} from "../../schemas/security-config";
import type { EmailConfig } from "../../services/email/types";
import type { SingleConfig } from "../../singles/config/types";
import type { StoragePlugin } from "../../storage/types";
import type { UserConfig } from "../../users/config/types";

// ============================================================
// TypeScript Configuration
// ============================================================

/**
 * TypeScript code generation configuration.
 *
 * Controls how TypeScript types are generated for collections.
 */
export interface TypeScriptConfig {
  /**
   * Path to the generated TypeScript file.
   * Can be absolute or relative to the project root.
   *
   * @default './src/types/generated/payload-types.ts'
   */
  outputFile?: string;

  /**
   * Whether to add module augmentation declarations.
   * When `true`, generates `declare module` blocks for type inference.
   *
   * @default true
   */
  declare?: boolean;
}

// ============================================================
// Database Configuration
// ============================================================

/**
 * Database schema and migration configuration.
 *
 * Controls where Drizzle schemas and migration files are generated.
 */
export interface DatabaseConfig {
  /**
   * Directory for generated Drizzle schema files.
   * Each collection generates a separate schema file.
   *
   * @default './src/db/schemas/collections'
   */
  schemasDir?: string;

  /**
   * Directory for generated migration files.
   * Migrations are created via CLI commands.
   *
   * @default './src/db/migrations'
   */
  migrationsDir?: string;
}

// ============================================================
// Rate Limiting Configuration
// ============================================================

/**
 * Rate limiting configuration for API protection.
 *
 * Protects against abuse by limiting the number of requests
 * per time window. Enabled by default (100 read / 30 write per minute).
 * Opt out with `rateLimit: { enabled: false }`.
 */
export interface RateLimitingConfig {
  /**
   * Enable rate limiting.
   * @default true
   */
  enabled: boolean;

  /**
   * Maximum requests per window for read operations (GET).
   * @default 100
   */
  readLimit?: number;

  /**
   * Maximum requests per window for write operations (POST, PATCH, PUT, DELETE).
   * @default 30
   */
  writeLimit?: number;

  /**
   * Time window in milliseconds.
   * @default 60000 (1 minute)
   */
  windowMs?: number;

  /**
   * Custom store for rate limit state.
   * Defaults to in-memory store if not provided.
   *
   * For production with multiple instances, use a Redis-backed store.
   */
  store?: RateLimitStore;

  /**
   * Function to generate a unique key for rate limiting.
   * Defaults to using the client IP address.
   */
  keyGenerator?: (request: Request) => string;

  /**
   * Function to skip rate limiting for certain requests.
   * Returns true to skip rate limiting.
   */
  skip?: (request: Request) => boolean | Promise<boolean>;

  /**
   * Per-collection rate limit overrides.
   */
  collections?: Record<
    string,
    {
      readLimit?: number;
      writeLimit?: number;
    }
  >;
}

/**
 * Sanitized rate limiting configuration with defaults applied.
 */
export interface SanitizedRateLimitingConfig {
  /** Rate limiting is enabled */
  enabled: true;
  /** Maximum requests per window for read operations (GET) */
  readLimit: number;
  /** Maximum requests per window for write operations (POST, PATCH, PUT, DELETE) */
  writeLimit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom store for rate limit state (optional) */
  store?: RateLimitStore;
  /** Function to generate a unique key for rate limiting (optional) */
  keyGenerator?: (request: Request) => string;
  /** Function to skip rate limiting for certain requests (optional) */
  skip?: (request: Request) => boolean | Promise<boolean>;
  /** Per-collection rate limit overrides (optional) */
  collections?: Record<string, { readLimit?: number; writeLimit?: number }>;
}

// ============================================================
// API Key Configuration
// ============================================================

/**
 * API key configuration.
 *
 * Controls per-key rate limiting for API key authentication.
 * All fields are optional — omitting the block entirely uses built-in defaults.
 */
export interface ApiKeysConfig {
  /**
   * Per-key rate limiting settings.
   * Omit to use defaults (1 000 req/hour, 1-hour window).
   */
  rateLimit?: {
    /**
     * Maximum requests an API key may make per sliding window.
     * Must be a positive integer.
     * @default 1000
     */
    requestsPerHour?: number;

    /**
     * Sliding window duration in milliseconds.
     * @default 3_600_000 (1 hour)
     */
    windowMs?: number;
  };
}

/**
 * Sanitized API key configuration with all defaults applied.
 */
export interface SanitizedApiKeysConfig {
  rateLimit: {
    /** Maximum requests per sliding window. */
    requestsPerHour: number;
    /** Sliding window duration in milliseconds. */
    windowMs: number;
  };
}

// ============================================================
// Security Configuration
// ============================================================

/**
 * Security configuration for Nextly.
 *
 * Controls security headers, CORS, file upload restrictions, and
 * input sanitization. All sub-sections are optional — secure defaults
 * are applied by the respective middleware factories at runtime.
 */
export interface SecurityConfig {
  /**
   * Security response headers configuration.
   *
   * Controls CSP, X-Content-Type-Options, X-Frame-Options, HSTS,
   * Referrer-Policy, and Permissions-Policy headers on API responses.
   * Each header can be set to a custom string or `false` to disable.
   * Omitted headers use secure defaults.
   */
  headers?: SecurityHeadersConfig;

  /**
   * Cross-Origin Resource Sharing (CORS) configuration.
   *
   * Default: same-origin only (no CORS headers). Use `origin: ['*']`
   * for development or provide an explicit allowlist for production.
   */
  cors?: CorsConfig;

  /**
   * File upload security configuration.
   *
   * Controls MIME type allowlist and SVG serving behaviour.
   * Default: common safe MIME types allowed, HTML/JS blocked,
   * SVG served with restrictive CSP.
   */
  uploads?: UploadSecurityConfigInput;

  /**
   * Input sanitization configuration.
   *
   * Controls HTML tag stripping for plain-text fields, CSS value
   * validation in rich text, and URL protocol validation.
   * All features enabled by default.
   */
  sanitization?: SanitizationConfigInput;
}

// ============================================================
// Admin Configuration
// ============================================================

/**
 * Resolved (HSL-triplet) color overrides for the admin UI.
 * These are derived from AdminBrandingColors after server-side hex conversion.
 */
export interface AdminBrandingColors {
  /** Hex color for the primary brand color, e.g. "#6366f1". Replaces blue-500. */
  primary?: string;
  /** Hex color for the accent brand color, e.g. "#f59e0b". Replaces cyan-500. */
  accent?: string;
}

/**
 * Branding configuration for the Nextly admin UI.
 */
export interface AdminBrandingConfig {
  /**
   * URL of a logo image to display in the sidebar.
   * Can be an absolute URL or a path served from your Next.js public folder.
   * When set, the logo image is shown instead of the text logo.
   *
   * @example "/logo.svg" or "https://cdn.example.com/logo.png"
   */
  logoUrl?: string;

  /**
   * URL of the light-mode logo image.
   * Used when `logoUrl` is not set.
   */
  logoUrlLight?: string;

  /**
   * URL of the dark-mode logo image.
   * Used when `logoUrl` is not set.
   */
  logoUrlDark?: string;

  /**
   * Text label shown in the sidebar header.
   * Replaces the default "Nextly" label.
   * Also used as the `alt` attribute when `logoUrl` is set.
   *
   * @default "Nextly"
   */
  logoText?: string;

  /**
   * URL of a custom favicon to inject into the admin page.
   */
  favicon?: string;

  /**
   * Custom brand colors for the admin UI.
   * Accept 6-digit hex values only (e.g. "#6366f1").
   * Foreground colors are calculated automatically to ensure WCAG AA contrast.
   */
  colors?: AdminBrandingColors;

  /**
   * Toggle visibility of builder-related navigation (Collections/Singles/Components builders).
   *
   * This is evaluated at runtime via the `/api/admin-meta` response.
   *
   * Default behavior follows `NODE_ENV`:
   * - `production` => hidden
   * - `development` / `test` => visible
   *
   * Precedence:
   * 1) `admin.branding.showBuilder` (this field)
   * 2) `NODE_ENV` default mapping
   *
   * @default `process.env.NODE_ENV !== "production"`
   */
  showBuilder?: boolean;
}

/**
 * Per-plugin overrides for sidebar placement and appearance.
 *
 * The host developer can override any subset of a plugin's admin config
 * without modifying the plugin's source code. Uses shallow merge —
 * only specified fields override the plugin author's defaults.
 */
export interface PluginOverride {
  /** Override the plugin's sidebar placement */
  placement?: AdminPlacement;
  /** Override the plugin's sort order */
  order?: number;
  /** Override the position anchor for standalone plugins (which built-in section to appear after) */
  after?:
    | "dashboard"
    | "collections"
    | "singles"
    | "media"
    | "plugins"
    | "users"
    | "settings";
  /** Override or extend the plugin's sidebar appearance (shallow-merged) */
  appearance?: Partial<PluginAdminAppearance>;
}

/**
 * Top-level admin UI configuration for the Nextly admin panel.
 */
export interface AdminConfig {
  /** Branding customizations: logo, colors, favicon. */
  branding?: AdminBrandingConfig;

  /**
   * Per-plugin overrides for sidebar placement and appearance.
   *
   * Keys are plugin slugs (derived from plugin name, e.g., "form-builder").
   * Values are partial overrides — only specified fields are changed.
   */
  pluginOverrides?: Record<string, PluginOverride>;
}

// ============================================================
// Auth Configuration
// ============================================================

/**
 * Authentication configuration for Nextly.
 *
 * PR 5 (unified-error-system): introduces the `revealRegistrationConflict`
 * opt-in flag. Default behaviour is silent-success on duplicate-email
 * registration to prevent account enumeration via the registration form
 * (spec §13.2). Some products (e.g. internal admin tools where every user
 * is known) prefer an explicit "email already in use" message — flip this
 * to `true` to opt into the legacy reveal-on-conflict behaviour.
 */
export interface AuthConfig {
  /**
   * Whether `/auth/register` should respond with an explicit
   * `DUPLICATE` / "An account already exists for this email." error when
   * the submitted email is already registered.
   *
   * Default: `false`. The registration endpoint instead returns the same
   * "If this email is available, we've sent a confirmation link." success
   * shape it would on a fresh signup, regardless of whether the email
   * existed. The duplicate is logged for operators.
   *
   * Set to `true` only if your threat model genuinely doesn't care about
   * email enumeration (e.g. a closed admin tool with controlled signup).
   */
  revealRegistrationConflict?: boolean;
}

/**
 * Sanitized auth configuration with all defaults applied.
 */
export interface SanitizedAuthConfig {
  /** Whether to reveal duplicate-email registrations on the wire. Defaults to false. */
  revealRegistrationConflict: boolean;
}

/**
 * Default auth configuration values.
 */
export const DEFAULT_AUTH_CONFIG: SanitizedAuthConfig = {
  revealRegistrationConflict: false,
};

// ============================================================
// Nextly Config
// ============================================================

/**
 * Complete Nextly configuration interface.
 *
 * This is the main configuration object for a Nextly application,
 * typically exported from `nextly.config.ts` at the project root.
 */
export interface NextlyConfig {
  /** Array of collection configurations. */
  collections?: CollectionConfig[];

  /** Array of Single configurations. */
  singles?: SingleConfig[];

  /** Array of Component configurations. */
  components?: ComponentConfig[];

  /** User model extension configuration. */
  users?: UserConfig;

  /** Email provider and template configuration. */
  email?: EmailConfig;

  /** TypeScript type generation configuration. */
  typescript?: TypeScriptConfig;

  /** Database schema and migration configuration. */
  db?: DatabaseConfig;

  /**
   * Rate limiting configuration for API protection.
   *
   * Enabled by default (100 read / 30 write per minute). Opt out with `enabled: false`.
   */
  rateLimit?: RateLimitingConfig;

  /**
   * API key authentication configuration.
   *
   * Controls per-key rate limiting applied when requests authenticate via
   * `Authorization: Bearer sk_live_...`. Session-based requests are unaffected.
   */
  apiKeys?: ApiKeysConfig;

  /**
   * Authentication configuration.
   *
   * Currently exposes the `revealRegistrationConflict` opt-in flag (PR 5,
   * spec §13.2). Future auth-related options (token TTLs, lockout policy,
   * etc.) will land here so the wire surface has a single canonical home.
   */
  auth?: AuthConfig;

  /** Storage plugins for cloud storage providers. */
  storage?: StoragePlugin[];

  /** Plugins to extend Nextly functionality. */
  plugins?: PluginDefinition[];

  /** Security configuration for headers, CORS, uploads, and sanitization. */
  security?: SecurityConfig;

  /** Admin UI customization. */
  admin?: AdminConfig;
}

/**
 * Normalized Nextly configuration with all defaults applied.
 *
 * This type represents the config after `sanitizeConfig()` has processed it,
 * with all array-valued and default-bearing fields filled in.
 *
 * Returned by `defineConfig()` and consumed by `getNextly()`, the DI
 * registration pipeline, and downstream services.
 */
export interface SanitizedNextlyConfig {
  /** Array of collection configurations (empty array if none provided). */
  collections: CollectionConfig[];

  /** Array of Single configurations (empty array if none provided). */
  singles: SingleConfig[];

  /** Array of Component configurations (empty array if none provided). */
  components: ComponentConfig[];

  /** User model extension configuration. Undefined if no user config provided. */
  users?: UserConfig;

  /** Email provider and template configuration. Undefined if no email config provided. */
  email?: EmailConfig;

  /** TypeScript configuration with defaults applied. */
  typescript: Required<TypeScriptConfig>;

  /** Database configuration with defaults applied. */
  db: Required<DatabaseConfig>;

  /**
   * Rate limiting configuration.
   * Built automatically unless `rateLimit: { enabled: false }` is set.
   */
  rateLimit?: SanitizedRateLimitingConfig;

  /**
   * API key configuration with defaults applied.
   * Undefined if omitted from defineConfig() (built-in defaults used).
   */
  apiKeys?: SanitizedApiKeysConfig;

  /**
   * Auth configuration with defaults applied. Always present after
   * sanitization; the `revealRegistrationConflict` flag falls back to
   * `false` (silent-success on duplicate email).
   */
  auth: SanitizedAuthConfig;

  /** Storage plugins for cloud storage providers (empty array if none configured). */
  storage: StoragePlugin[];

  /** Plugins to extend Nextly functionality (empty array if none configured). */
  plugins: PluginDefinition[];

  /** Security configuration for headers, CORS, uploads, and sanitization. */
  security?: SecurityConfig;

  /** Admin UI customization config. */
  admin?: AdminConfig;
}

// ============================================================
// Default Values
// ============================================================

/**
 * Default TypeScript configuration values.
 */
export const DEFAULT_TYPESCRIPT_CONFIG: Required<TypeScriptConfig> = {
  outputFile: "./src/types/generated/payload-types.ts",
  declare: true,
};

/**
 * Default database configuration values.
 */
export const DEFAULT_DB_CONFIG: Required<DatabaseConfig> = {
  schemasDir: "./src/db/schemas/collections",
  migrationsDir: "./src/db/migrations",
};

/**
 * Default rate limiting configuration values.
 * Only applied when rate limiting is enabled.
 */
export const DEFAULT_RATE_LIMIT_CONFIG = {
  readLimit: 100,
  writeLimit: 30,
  windowMs: 60000,
} as const;

/**
 * Default API key rate limiting values.
 * Applied when `apiKeys.rateLimit` fields are omitted.
 */
export const DEFAULT_API_KEYS_CONFIG = {
  requestsPerHour: 1_000,
  windowMs: 3_600_000,
} as const;

// ============================================================
// sanitizeConfig
// ============================================================

/**
 * Fill defaults on a raw `NextlyConfig` and return a `SanitizedNextlyConfig`.
 *
 * This is a pure transformation — it does **not** validate slug uniqueness,
 * component nesting depth, or user-field constraints. Callers that need
 * validation (like `defineConfig()`) should validate first and then call
 * this helper.
 *
 * After this step, downstream code can rely on `collections`, `singles`,
 * `components`, `storage`, `plugins`, `typescript`, and `db` being present
 * and nil-check-free.
 *
 * Validates that `apiKeys.rateLimit.requestsPerHour` and `apiKeys.rateLimit.windowMs`
 * are positive, because accepting those values without a bound would silently
 * disable rate limiting in production.
 *
 * @param config - Raw Nextly configuration
 * @returns Sanitized configuration with defaults applied
 * @throws Error if `apiKeys.rateLimit` values are invalid
 */
export function sanitizeConfig(config: NextlyConfig): SanitizedNextlyConfig {
  // Validate apiKeys.rateLimit bounds — these are runtime-critical.
  if (config.apiKeys?.rateLimit?.requestsPerHour !== undefined) {
    if (
      !Number.isInteger(config.apiKeys.rateLimit.requestsPerHour) ||
      config.apiKeys.rateLimit.requestsPerHour <= 0
    ) {
      throw new Error(
        `apiKeys.rateLimit.requestsPerHour must be a positive integer (got ${config.apiKeys.rateLimit.requestsPerHour})`
      );
    }
  }

  if (config.apiKeys?.rateLimit?.windowMs !== undefined) {
    if (
      typeof config.apiKeys.rateLimit.windowMs !== "number" ||
      config.apiKeys.rateLimit.windowMs <= 0
    ) {
      throw new Error(
        `apiKeys.rateLimit.windowMs must be a positive number (got ${config.apiKeys.rateLimit.windowMs})`
      );
    }
  }

  // Build rate limit config — enabled by default (opt-out with `enabled: false`).
  let rateLimit: SanitizedRateLimitingConfig | undefined;
  if (config.rateLimit?.enabled !== false) {
    rateLimit = {
      enabled: true,
      readLimit:
        config.rateLimit?.readLimit ?? DEFAULT_RATE_LIMIT_CONFIG.readLimit,
      writeLimit:
        config.rateLimit?.writeLimit ?? DEFAULT_RATE_LIMIT_CONFIG.writeLimit,
      windowMs:
        config.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_CONFIG.windowMs,
      store: config.rateLimit?.store,
      keyGenerator: config.rateLimit?.keyGenerator,
      skip: config.rateLimit?.skip,
      collections: config.rateLimit?.collections,
    };
  }

  // Build apiKeys config only if the block is provided; omitting it entirely
  // is valid — the auth middleware falls back to built-in defaults.
  const apiKeys: SanitizedApiKeysConfig | undefined = config.apiKeys
    ? {
        rateLimit: {
          requestsPerHour:
            config.apiKeys.rateLimit?.requestsPerHour ??
            DEFAULT_API_KEYS_CONFIG.requestsPerHour,
          windowMs:
            config.apiKeys.rateLimit?.windowMs ??
            DEFAULT_API_KEYS_CONFIG.windowMs,
        },
      }
    : undefined;

  return {
    collections: config.collections ?? [],
    singles: config.singles ?? [],
    components: config.components ?? [],
    users: config.users,
    email: config.email,
    typescript: {
      outputFile:
        config.typescript?.outputFile ?? DEFAULT_TYPESCRIPT_CONFIG.outputFile,
      declare: config.typescript?.declare ?? DEFAULT_TYPESCRIPT_CONFIG.declare,
    },
    db: {
      schemasDir: config.db?.schemasDir ?? DEFAULT_DB_CONFIG.schemasDir,
      migrationsDir:
        config.db?.migrationsDir ?? DEFAULT_DB_CONFIG.migrationsDir,
    },
    rateLimit,
    apiKeys,
    // PR 5 (unified-error-system): always present after sanitization so
    // downstream code can read `config.auth.revealRegistrationConflict`
    // without nil checks. Defaults to silent-success per spec §13.2.
    auth: {
      revealRegistrationConflict:
        config.auth?.revealRegistrationConflict ??
        DEFAULT_AUTH_CONFIG.revealRegistrationConflict,
    },
    storage: config.storage ?? [],
    plugins: config.plugins ?? [],
    security: config.security,
    admin: config.admin,
  };
}
