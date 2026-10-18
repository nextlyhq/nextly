/**
 * The startup line naming each plugin auth route that cannot say which
 * identity a request names, read from a real boot.
 *
 * Such a route's requests from clients whose address cannot be read are
 * bounded only by its plugin's ceiling, and nothing about a working route
 * shows that, so the boot names it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../../services/shared";
import { definePlugin } from "../plugin-context";
import type { TestNextly } from "../test-nextly";
import { createTestNextly } from "../test-nextly";

const ok = () => Response.json({ ok: true });

const authPlugin = definePlugin({
  name: "@test/auth-routes",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/callback",
        public: true,
        rateLimit: "auth",
        handler: ok,
      },
      {
        method: "POST",
        path: "/start",
        public: true,
        rateLimit: "auth",
        limitKey: () => ({ handles: true, key: "k" }),
        handler: ok,
      },
    ],
  },
});

function recordingLogger(warnings: string[]): Logger {
  return {
    debug() {},
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
  };
}

/** The startup lines about auth routes without a limitKey. */
function unkeyedLines(warnings: string[]): string[] {
  return warnings.filter(line => line.includes("names no limitKey"));
}

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  vi.unstubAllEnvs();
});

describe("the startup line for plugin auth routes without a limitKey", () => {
  it("names each such route, and only those", async () => {
    const warnings: string[] = [];
    handle = await createTestNextly({
      plugins: [authPlugin],
      logger: recordingLogger(warnings),
    });

    const lines = unkeyedLines(warnings);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      'Plugin "@test/auth-routes" route POST /plugins/@test/auth-routes/callback'
    );
  });

  it("says nothing while the auth limit is off", async () => {
    const warnings: string[] = [];
    handle = await createTestNextly({
      plugins: [authPlugin],
      logger: recordingLogger(warnings),
      security: { authRateLimit: { requestsPerHour: 0 } },
    });

    expect(unkeyedLines(warnings)).toEqual([]);
  });
});
