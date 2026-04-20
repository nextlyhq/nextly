import { describe, it, expect, vi, beforeEach } from "vitest";

import { createTelemetryClient } from "../client.js";

// Mock posthog-node BEFORE importing the client. We only care about what
// our wrapper passes to it and that shutdown is awaited with a timeout.
const captureSpy = vi.fn();
const shutdownSpy = vi.fn().mockResolvedValue(undefined);
const constructorSpy = vi.fn();

vi.mock("posthog-node", () => ({
  // Class form so `new PostHog(...)` works (arrow functions are not constructable).
  PostHog: class MockPostHog {
    capture = captureSpy;
    shutdown = shutdownSpy;
    constructor(token: string, opts: unknown) {
      constructorSpy(token, opts);
    }
  },
}));

beforeEach(() => {
  captureSpy.mockClear();
  shutdownSpy.mockClear();
  constructorSpy.mockClear();
});

describe("createTelemetryClient", () => {
  it("passes flushAt=1 and disableGeoip=true to the PostHog constructor", () => {
    createTelemetryClient({
      token: "phc_x",
      host: "https://telemetry.nextlyhq.com/",
    });
    expect(constructorSpy).toHaveBeenCalledWith(
      "phc_x",
      expect.objectContaining({
        host: "https://telemetry.nextlyhq.com/",
        flushAt: 1,
        flushInterval: 0,
        disableGeoip: true,
      })
    );
  });

  it("forwards capture with the correct payload shape", () => {
    const client = createTelemetryClient({
      token: "phc_x",
      host: "https://telemetry.nextlyhq.com/",
    });
    client.capture({
      distinctId: "abc",
      event: "scaffold_started",
      properties: {
        flags: {
          yes: false,
          demoData: true,
          skipInstall: false,
          useYalc: false,
        },
      },
    });
    expect(captureSpy).toHaveBeenCalledWith({
      distinctId: "abc",
      event: "scaffold_started",
      properties: {
        flags: {
          yes: false,
          demoData: true,
          skipInstall: false,
          useYalc: false,
        },
      },
    });
  });

  it("shutdown() resolves even when posthog.shutdown hangs past the timeout", async () => {
    shutdownSpy.mockImplementationOnce(
      () =>
        new Promise(() => {
          /* never resolves */
        })
    );
    const client = createTelemetryClient({
      token: "phc_x",
      host: "https://x",
      timeoutMs: 50,
    });
    const start = Date.now();
    await client.shutdown();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("shutdown() swallows errors from posthog.shutdown", async () => {
    shutdownSpy.mockRejectedValueOnce(new Error("network down"));
    const client = createTelemetryClient({
      token: "phc_x",
      host: "https://x",
    });
    await expect(client.shutdown()).resolves.toBeUndefined();
  });
});
