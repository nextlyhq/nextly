/**
 * The default auth logger writes no full email address outside development and test.
 *
 * `logAuth` drops an `email` field, but an address can still arrive inside an error message,
 * and callers that log through `getAuthLogger()` directly skip that step. So the default writer
 * masks the whole payload before it reaches the console.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AuthLogEvent,
  type DbLogEventBase,
  getAuthLogger,
  getDbLogger,
  logDbConn,
  setAuthLogger,
  setDbLogger,
} from "../logger";

const ADDRESS = "john@example.com";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** What the default auth logger writes for a failure quoting the address, under `nodeEnv`. */
function written(nodeEnv: string): string {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NODE_ENV", nodeEnv);
  getAuthLogger().log("warn", {
    category: "auth",
    op: "sign-in",
    errorMessage: `No account matched ${ADDRESS}`,
  });
  return JSON.stringify(warn.mock.calls);
}

describe("the default auth logger", () => {
  it("masks an address in what it writes in production", () => {
    const output = written("production");
    // The control: the event was written, with its message.
    expect(output).toContain("No account matched");
    expect(output).not.toContain(ADDRESS);
    expect(output).toContain("j***@example.com");
  });

  it("writes it whole in development", () => {
    expect(written("development")).toContain(ADDRESS);
  });
});

describe("the default auth logger and credentials", () => {
  it.each(["production", "development"])(
    "writes no token or key in %s, in a field or in text",
    nodeEnv => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("NODE_ENV", nodeEnv);
      getAuthLogger().log("warn", {
        category: "auth",
        op: "sign-in",
        errorMessage: "Rejected Bearer nx_live_c2hvdWxkTmV2ZXJCZUxvZ2dlZA",
        refreshToken: "refresh-c2hvdWxkTmV2ZXI",
      });
      const output = JSON.stringify(warn.mock.calls);
      // The control: the event was written, with its message.
      expect(output).toContain("Rejected Bearer");
      expect(output).not.toContain("nx_live_c2hvdWxkTmV2ZXJCZUxvZ2dlZA");
      expect(output).not.toContain("refresh-c2hvdWxkTmV2ZXI");
    }
  );
});

describe("an auth logger an app installs", () => {
  it("receives events with the credentials taken out", () => {
    const installed = getAuthLogger();
    const received: AuthLogEvent[] = [];
    setAuthLogger({ log: (_, event) => received.push(event) });
    try {
      getAuthLogger().log("error", {
        category: "auth",
        op: "permissions",
        error: "Could not read: Bearer nx_live_aW5zdGFsbGVkTG9nZ2Vy",
        sessionToken: "session-aW5zdGFsbGVk",
      });
    } finally {
      setAuthLogger(installed);
    }

    const output = JSON.stringify(received);
    // The control: the event arrived, with its words.
    expect(output).toContain("Could not read: Bearer");
    expect(output).not.toContain("nx_live_aW5zdGFsbGVkTG9nZ2Vy");
    expect(output).not.toContain("session-aW5zdGFsbGVk");
  });
});

describe("a database logger an app installs", () => {
  it("receives events with the credentials taken out", () => {
    const installed = getDbLogger();
    const received: DbLogEventBase[] = [];
    setDbLogger({ log: (_, event) => received.push(event) });
    try {
      logDbConn("error", {
        dialect: "postgresql",
        op: "health-fail",
        errorMessage:
          "connect failed for postgres://app:db-password-1@db.example.test/app",
        token: "db-token-2",
      });
    } finally {
      setDbLogger(installed);
    }

    const output = JSON.stringify(received);
    // The control: the event arrived, with its words.
    expect(output).toContain("connect failed for");
    expect(output).not.toContain("db-password-1");
    expect(output).not.toContain("db-token-2");
  });
});
