import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readMachineUsage,
  resolveToolsUsage,
  saveMachineUsageOff,
} from "../index.js";

// The machine's own setting, kept in the same store `nextly telemetry`
// uses. Each test gets a store of its own in a temporary folder.

let cwd = "";
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "nextly-machine-usage-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("the machine's usage-data setting", () => {
  it("starts on, with a random machine id", () => {
    const machine = readMachineUsage({ cwd });
    expect(machine.enabled).toBe(true);
    expect(machine.anonymousId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the same machine id between runs", () => {
    expect(readMachineUsage({ cwd }).anonymousId).toBe(
      readMachineUsage({ cwd }).anonymousId
    );
  });

  it("saves off, and the next run reads it as a person's no", () => {
    const before = readMachineUsage({ cwd });
    saveMachineUsageOff({ cwd });
    const after = readMachineUsage({ cwd });
    expect(after).toEqual({ enabled: false, anonymousId: before.anonymousId });
    expect(
      resolveToolsUsage({ env: {}, machineEnabled: after.enabled })
    ).toEqual({ on: false, reason: "machine-setting", personSaidNo: true });
  });
});
