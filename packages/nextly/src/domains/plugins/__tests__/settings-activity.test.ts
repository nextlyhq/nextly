/**
 * A committed change to a plugin's settings is recorded by key name and
 * announced to listeners — and never reported as failed afterwards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  calls: [] as unknown[],
  fail: false,
}));
const emitted = vi.hoisted(
  () => [] as Array<{ name: string; payload: unknown }>
);

vi.mock("../../audit/record-settings-activity", () => ({
  recordSettingsActivity: async (input: unknown) => {
    if (recorded.fail) throw new Error("activity_log unavailable");
    recorded.calls.push(input);
  },
}));
vi.mock("../../../events/domain-events", () => ({
  safeEmit: (name: string, payload: unknown) => emitted.push({ name, payload }),
}));

import { announcePluginSettingsChange } from "../settings-activity";

beforeEach(() => {
  recorded.calls.length = 0;
  recorded.fail = false;
  emitted.length = 0;
});

describe("announcing a plugin settings change", () => {
  it("records the changed keys by name under the settings namespace", async () => {
    await announcePluginSettingsChange({
      plugin: "acme-auth",
      changedKeys: ["clientSecret"],
      actor: { type: "user", id: "user-7" },
    });

    expect(recorded.calls).toEqual([
      expect.objectContaining({
        action: "update",
        collection: "settings",
        entityId: "acme-auth",
        changedFields: ["clientSecret"],
        actor: { type: "user", id: "user-7" },
      }),
    ]);
  });

  it("emits plugin.settings.changed with the plugin and the keys", async () => {
    await announcePluginSettingsChange({
      plugin: "acme-auth",
      changedKeys: ["port"],
    });

    expect(emitted).toEqual([
      {
        name: "plugin.settings.changed",
        payload: { plugin: "acme-auth", changedKeys: ["port"] },
      },
    ]);
  });

  it("records and announces nothing when nothing changed", async () => {
    await announcePluginSettingsChange({
      plugin: "acme-auth",
      changedKeys: [],
      actor: { type: "user", id: "user-7" },
    });

    expect(recorded.calls).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("does not throw when the record cannot be written, and still announces", async () => {
    // The write has committed; a failure here must not turn it into one.
    recorded.fail = true;
    await expect(
      announcePluginSettingsChange({
        plugin: "acme-auth",
        changedKeys: ["port"],
        actor: { type: "user", id: "user-7" },
      })
    ).resolves.toBeUndefined();
    expect(emitted).toHaveLength(1);
  });
});
