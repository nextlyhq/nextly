/**
 * No credential reaches a log line, in any environment.
 *
 * A service that logs its options logs the request they carry, and Node's
 * console prints a Fetch `Request` with its headers: a Single update wrote the
 * caller's `Authorization: Bearer` API key and session cookie into a
 * production log that way. These hand the loggers exactly that payload and
 * read what reaches the console as Node would print it, so a request, header
 * or field that slips through in any form fails here, while the method and
 * path an operator needs still arrive.
 */
import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../shared/types";

import { getNextlyLogger, setNextlyLogger } from "./logger";
import { maskingServiceLogger } from "./mask-emails";

// Plainly synthetic, so no scanner reads them as real credentials; the shapes
// are what matter: an API key behind `Bearer`, a cookie behind its name.
const KEY = `nx_live_${"testkey".repeat(6)}t`;
const SESSION_VALUE = "test-session-cookie-value";
const SESSION = `nextly_session=${SESSION_VALUE}`;

/** A Single update's options as a route hands them to the service. */
function updateOptions() {
  return {
    locale: "en",
    overrideAccess: false,
    request: new Request("https://example.com/admin/api/singles/home?x=1", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${KEY}`,
        cookie: SESSION,
        "x-csrf-token": "test-csrf-token-value",
      },
    }),
  };
}

/** Everything a console spy received, as Node's console would print it. */
function printed(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .flat()
    .map(arg =>
      typeof arg === "string" ? arg : inspect(arg, { depth: Infinity })
    )
    .join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(["production", "development", "test"])(
  "the service console logger with NODE_ENV=%s",
  nodeEnv => {
    it("prints no key, cookie or token from a request in its fields", () => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

      consoleLogger.debug("Updating Single document", {
        slug: "home",
        options: updateOptions(),
      });

      const out = printed(debug);
      // POPULATION CONTROL: the line was written, with what an operator needs.
      expect(out).toContain("Updating Single document");
      expect(out).toContain("home");
      expect(out).toContain("PATCH");
      expect(out).toContain("/admin/api/singles/home");
      expect(out).not.toContain(KEY);
      expect(out).not.toContain(SESSION_VALUE);
      expect(out).not.toContain("test-csrf-token-value");
    });
  }
);

describe("an app's own service logger", () => {
  it("receives fields with the credentials taken out", () => {
    const received: unknown[] = [];
    const appLogger = {
      debug: (_: string, meta?: unknown) => received.push(meta),
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    maskingServiceLogger(appLogger).debug("Updating Single document", {
      options: updateOptions(),
      headers: { Authorization: `Bearer ${KEY}`, "Set-Cookie": SESSION },
      password: "hunter2-secret",
      apiKey: KEY,
    });

    const out = inspect(received, { depth: Infinity });
    expect(out).toContain("PATCH");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(SESSION_VALUE);
    expect(out).not.toContain("hunter2-secret");
  });

  it("takes a bearer credential out of the message text too", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    consoleLogger.debug(`Rejected Authorization: Bearer ${KEY}`);

    const out = printed(debug);
    expect(out).toContain("Rejected Authorization: Bearer");
    expect(out).not.toContain(KEY);
  });
});

describe("the structured logger", () => {
  it("writes no credential from a payload", () => {
    const original = getNextlyLogger();
    const lines: unknown[] = [];
    setNextlyLogger({
      error: p => lines.push(p),
      warn: p => lines.push(p),
      info: p => lines.push(p),
      debug: p => lines.push(p),
    });
    try {
      getNextlyLogger().info({
        kind: "request",
        options: updateOptions(),
        token: "refresh-abc-123",
      });
    } finally {
      setNextlyLogger(original);
    }

    const out = inspect(lines, { depth: Infinity });
    expect(out).toContain("request");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("refresh-abc-123");
  });
});
