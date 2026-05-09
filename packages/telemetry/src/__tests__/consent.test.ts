import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createConsentStore } from "../consent.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "nextly-telemetry-test-"));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("createConsentStore", () => {
  it("creates a new state with default enabled=true on first load", () => {
    const store = createConsentStore({ cwd: tempDir });
    const state = store.load();
    expect(state.enabled).toBe(true);
    expect(state.notifiedAt).toBeNull();
    expect(state.anonymousId).toMatch(/^[0-9a-f]{64}$/);
    expect(state.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns the same anonymousId on subsequent loads", () => {
    const store = createConsentStore({ cwd: tempDir });
    const a = store.load();
    const b = store.load();
    expect(a.anonymousId).toBe(b.anonymousId);
    expect(a.salt).toBe(b.salt);
  });

  it("persists enabled=false after setEnabled(false)", () => {
    const store = createConsentStore({ cwd: tempDir });
    store.load();
    store.setEnabled(false);
    const fresh = createConsentStore({ cwd: tempDir });
    expect(fresh.load().enabled).toBe(false);
  });

  it("persists notifiedAt after markNotified()", () => {
    const store = createConsentStore({ cwd: tempDir });
    store.load();
    store.markNotified();
    const fresh = createConsentStore({ cwd: tempDir });
    expect(typeof fresh.load().notifiedAt).toBe("number");
  });

  it("reset() clears notifiedAt and rotates anonymousId", () => {
    const store = createConsentStore({ cwd: tempDir });
    const before = store.load();
    store.markNotified();
    store.reset();
    const after = store.load();
    expect(after.notifiedAt).toBeNull();
    expect(after.anonymousId).not.toBe(before.anonymousId);
    expect(after.enabled).toBe(true);
  });

  it("survives a corrupt config file by recreating it", () => {
    const store = createConsentStore({ cwd: tempDir });
    store.load();
    store.writeRaw("{ this is not json");
    const state = store.load();
    expect(state.enabled).toBe(true);
    expect(state.anonymousId).toMatch(/^[0-9a-f]{64}$/);
  });
});
