import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { container } from "../di/container";
import { logDbConn, nowMs } from "../lib/logger";

export interface HealthCheckResult {
  ok: boolean;
  timestamp: string;
  database: {
    connected: boolean;
    dialect: string;
    latencyMs: number;
  };
  error?: string;
}

export async function healthCheck(): Promise<HealthCheckResult> {
  const started = nowMs();
  const timestamp = new Date().toISOString();

  try {
    const adapter = container.get("adapter") as DrizzleAdapter;
    const dialect = adapter.getCapabilities().dialect;

    await adapter.executeQuery("SELECT 1");

    const latencyMs = nowMs() - started;
    logDbConn("info", { op: "health-ok", dialect, durationMs: latencyMs });

    return {
      ok: true,
      timestamp,
      database: { connected: true, dialect, latencyMs },
    };
  } catch (error) {
    const latencyMs = nowMs() - started;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown database error";

    logDbConn("error", {
      op: "health-fail",
      dialect: "unknown",
      durationMs: latencyMs,
      errorMessage,
    });

    return {
      ok: false,
      timestamp,
      database: { connected: false, dialect: "unknown", latencyMs },
      error: errorMessage,
    };
  }
}
