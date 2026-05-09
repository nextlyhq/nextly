import { PostHog } from "posthog-node";

import { SHUTDOWN_TIMEOUT_MS } from "./constants.js";

export interface CaptureArgs {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
}

export interface TelemetryClient {
  capture(args: CaptureArgs): void;
  shutdown(): Promise<void>;
}

interface CreateClientOptions {
  token: string;
  host: string;
  timeoutMs?: number;
}

// Wraps PostHog Node with the configuration we need for a CLI:
// - flushAt: 1, flushInterval: 0 so the next capture() flushes immediately.
//   Default posthog-node batches 20 events over 10s, which loses events in
//   short-lived CLI processes.
// - disableGeoip: true. We do not want PostHog to stamp an IP-derived
//   location onto anonymous CLI events.
// - shutdown() wrapped in Promise.race so a degraded network never hangs
//   the CLI. Errors are swallowed; telemetry failure must never surface.
export function createTelemetryClient(
  opts: CreateClientOptions
): TelemetryClient {
  const { token, host, timeoutMs = SHUTDOWN_TIMEOUT_MS } = opts;

  const posthog = new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });

  return {
    capture(args) {
      try {
        posthog.capture(args);
      } catch {
        // Capture failures must never surface to the user.
      }
    },
    async shutdown() {
      try {
        await Promise.race([
          posthog.shutdown(),
          new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
        ]);
      } catch {
        // Shutdown failures must never surface to the user.
      }
    },
  };
}
