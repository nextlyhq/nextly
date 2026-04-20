// Auto-detects PostgreSQL provider from DATABASE_URL pattern
// and returns appropriate connection defaults.
// Standard pg driver works with all providers - only config changes.

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

// Get connection defaults for a provider
export function getProviderDefaults(
  provider: PostgresProvider
): ProviderDefaults {
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
