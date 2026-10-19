/**
 * The default auth logger writes no full email address outside development and test.
 *
 * `logAuth` drops an `email` field, but an address can still arrive inside an error message,
 * and callers that log through `getAuthLogger()` directly skip that step. So the default writer
 * masks the whole payload before it reaches the console.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthLogger } from "../logger";

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
