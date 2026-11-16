// Auto-detects PostgreSQL provider from DATABASE_URL pattern
// and returns appropriate connection defaults.
// Standard pg driver works with all providers - only config changes.
import { SERVERLESS_POOL_DEFAULTS } from "@nextlyhq/adapter-drizzle/serverless";

export type PostgresProvider = "standard" | "neon" | "supabase";

export interface ProviderDefaults {
  ssl: boolean;
  poolMax: number;
  poolMin: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  retryAttempts: number;
}

// Detect provider from URL pattern or explicit override
export function detectPostgresProvider(
  url: string,
  explicitProvider?: string
): PostgresProvider {
  // Explicit override takes priority (if valid)
  if (explicitProvider) {
    const normalized = explicitProvider.toLowerCase();
    if (
      normalized === "neon" ||
      normalized === "supabase" ||
      normalized === "standard"
    ) {
      return normalized;
    }
  }

  // Auto-detect from URL hostname
  if (url.includes(".neon.tech") || url.includes("neon.")) {
    return "neon";
  }
  if (url.includes(".supabase.") || url.includes("supabase.")) {
    return "supabase";
  }

  return "standard";
}

/** Where the pool runs, as far as its defaults depend on it. */
export interface ProviderDefaultsOptions {
  /**
   * The pool runs inside serverless functions (Vercel's), whose suspended
   * instances keep their open connections: the pool size and idle timeout
   * come from `SERVERLESS_POOL_DEFAULTS` instead of the provider's, whatever
   * the provider, since a suspended instance holds a Neon or Supabase
   * connection as surely as any other. The provider keeps every other
   * setting: SSL, the connection and statement timeouts, the connect retries.
   */
  serverless?: boolean;
}

// Get connection defaults for a provider, for a pool that runs where
// `options` says.
export function getProviderDefaults(
  provider: PostgresProvider,
  options: ProviderDefaultsOptions = {}
): ProviderDefaults {
  const defaults = providerOwnDefaults(provider);
  if (!options.serverless) return defaults;
  return {
    ...defaults,
    poolMax: SERVERLESS_POOL_DEFAULTS.max,
    poolMin: SERVERLESS_POOL_DEFAULTS.min,
    idleTimeoutMs: SERVERLESS_POOL_DEFAULTS.idleTimeoutMs,
  };
}

// The provider's own defaults, for a long-running server.
function providerOwnDefaults(provider: PostgresProvider): ProviderDefaults {
  switch (provider) {
    case "neon":
      // Neon: serverless PG with auto-suspend, cold starts need more retries
      return {
        ssl: true,
        poolMax: 5,
        poolMin: 0,
        idleTimeoutMs: 10000,
        connectionTimeoutMs: 20000,
        statementTimeoutMs: 30000,
        retryAttempts: 5,
      };
    case "supabase":
      // Supabase: managed PG with Supavisor pooler, SSL required
      return {
        ssl: true,
        poolMax: 5,
        poolMin: 0,
        idleTimeoutMs: 30000,
        connectionTimeoutMs: 15000,
        statementTimeoutMs: 15000,
        retryAttempts: 3,
      };
    case "standard":
    default:
      // Standard: Docker, self-hosted, direct PG connections
      return {
        ssl: false,
        poolMax: 10,
        poolMin: 0,
        idleTimeoutMs: 30000,
        connectionTimeoutMs: 15000,
        statementTimeoutMs: 15000,
        retryAttempts: 3,
      };
  }
}
