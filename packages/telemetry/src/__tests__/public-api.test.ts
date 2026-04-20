import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, it, expect, vi, beforeEach } from "vitest";

import * as api from "../index.js";

const captureSpy = vi.fn();
const shutdownSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("posthog-node", () => ({
  PostHog: class MockPostHog {
    capture = captureSpy;
    shutdown = shutdownSpy;
    constructor(_token: string, _opts: unknown) {
      // intentionally unused
    }
  },
}));

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "nextly-public-api-"));
  captureSpy.mockClear();
  shutdownSpy.mockClear();
});

describe("public API", () => {
  it("init() with disabled=true skips posthog.capture on every call", async () => {
    await api.init({
      cliName: "nextly",
      cliVersion: "0.1.3",
      env: { DO_NOT_TRACK: "1" },
      isTty: true,
      cwdOverride: tempDir,
    });
    api.capture("command_started", { command: "dev", flags_count: 0 });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("capture() forwards to posthog when enabled", async () => {
    await api.init({
      cliName: "nextly",
      cliVersion: "0.1.3",
      env: {},
      isTty: true,
      cwdOverride: tempDir,
    });
    api.capture("command_started", { command: "dev", flags_count: 2 });
    expect(captureSpy).toHaveBeenCalledTimes(1);
    const call = captureSpy.mock.calls[0]?.[0];
    expect(call.event).toBe("command_started");
    expect(call.properties.command).toBe("dev");
    expect(call.properties.flags_count).toBe(2);
    expect(call.properties.cli_name).toBe("nextly");
    expect(call.properties.cli_version).toBe("0.1.3");
    expect(call.properties.schema_version).toBe(1);
    expect(typeof call.distinctId).toBe("string");
  });

  it("shutdown() awaits posthog.shutdown when enabled", async () => {
    await api.init({
      cliName: "nextly",
      cliVersion: "0.1.3",
      env: {},
      isTty: true,
      cwdOverride: tempDir,
    });
    api.capture("command_started", { command: "dev", flags_count: 0 });
    await api.shutdown();
    expect(shutdownSpy).toHaveBeenCalled();
  });

  it("getStatus() returns enabled or the disabled reason", async () => {
    await api.init({
      cliName: "nextly",
      cliVersion: "0.1.3",
      env: { CI: "1" },
      isTty: true,
      cwdOverride: tempDir,
    });
    expect(api.getStatus()).toEqual({ disabled: true, reason: "ci" });

    const tempDir2 = mkdtempSync(join(tmpdir(), "nextly-public-api-"));
    await api.init({
      cliName: "nextly",
      cliVersion: "0.1.3",
      env: {},
      isTty: true,
      cwdOverride: tempDir2,
    });
    expect(api.getStatus()).toEqual({ disabled: false, reason: null });
    rmSync(tempDir2, { recursive: true, force: true });
  });
});
