/**
 * `nextly telemetry enable|disable|reset --dry-run` names the user-level
 * setting it would change and its new value, and leaves the setting alone:
 * the consent store is neither opened nor written. Without the flag, each
 * makes its change.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dryRunLines } from "../../dry-run";
import {
  telemetryDisableAction,
  telemetryEnableAction,
  telemetryResetAction,
} from "../telemetry";

// Every call that opens or writes the user's consent store, by name.
const store = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@nextlyhq/telemetry", () => ({
  init: async () => void store.calls.push("init"),
  shutdown: async () => void store.calls.push("shutdown"),
  setEnabled: (enabled: boolean) =>
    void store.calls.push(`setEnabled(${String(enabled)})`),
  resetConsent: () => void store.calls.push("resetConsent"),
  getStatus: () => ({ disabled: false }),
}));

let output: string[];
beforeEach(() => {
  store.calls = [];
  output = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    output.push(parts.map(String).join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

/** What the logger printed as info, without its symbol. */
const info = () =>
  output.filter(line => line.startsWith("ℹ ")).map(line => line.slice(2));

/** A command with no global options given, as the program hands one over. */
const command = () => new Command("telemetry").option("--no-color");

describe("nextly telemetry --dry-run", () => {
  it.each([
    {
      name: "enable",
      action: telemetryEnableAction,
      changes: ["telemetry to enabled for this user"],
      real: ["init", "setEnabled(true)", "shutdown"],
    },
    {
      name: "disable",
      action: telemetryDisableAction,
      changes: ["telemetry to disabled for this user"],
      real: ["init", "setEnabled(false)", "shutdown"],
    },
    {
      name: "reset",
      action: telemetryResetAction,
      changes: [
        "a new anonymous telemetry ID for this user",
        "telemetry to enabled for this user",
        "the first-run telemetry notice to show again",
      ],
      real: ["init", "resetConsent", "shutdown"],
    },
  ])(
    "$name names the setting it would change and leaves the store alone",
    async ({ action, changes, real }) => {
      await action({ dryRun: true }, command());

      expect(store.calls).toEqual([]);
      expect(info()).toEqual(
        dryRunLines({
          changes: changes.map(target => ({ action: "set", target })),
        })
      );

      // Without the flag, the same command makes its change.
      await action({}, command());
      expect(store.calls).toEqual(real);
    }
  );
});
