import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  autoRegisterPluginComponents,
  registerKnownPlugin,
  resetAutoRegistration,
} from "./component-registry";

describe("autoRegisterPluginComponents — per-module guard (D60)", () => {
  beforeEach(() => {
    resetAutoRegistration();
  });

  it("attempts a NEW module requested after the first call (P5 run-once gap fixed)", async () => {
    const regA = vi.fn(async () => {});
    const regB = vi.fn(async () => {});
    registerKnownPlugin("@acme/a", regA);
    registerKnownPlugin("@acme/b", regB);

    // First call only references module a.
    await autoRegisterPluginComponents(["@acme/a/admin#X"]);
    expect(regA).toHaveBeenCalledTimes(1);
    expect(regB).toHaveBeenCalledTimes(0);

    // Second call references a (already attempted) + b (new). b must be attempted.
    await autoRegisterPluginComponents(["@acme/a/admin#X2", "@acme/b/admin#Y"]);
    expect(regB).toHaveBeenCalledTimes(1);
    // a is NOT re-attempted (each module at most once → no import churn).
    expect(regA).toHaveBeenCalledTimes(1);
  });

  it("resets the per-module set so modules can be attempted again", async () => {
    const regA = vi.fn(async () => {});
    registerKnownPlugin("@acme/a", regA);

    await autoRegisterPluginComponents(["@acme/a/admin#X"]);
    expect(regA).toHaveBeenCalledTimes(1);

    resetAutoRegistration();
    await autoRegisterPluginComponents(["@acme/a/admin#X"]);
    expect(regA).toHaveBeenCalledTimes(2);
  });

  it("ignores paths without a module hash and empty input", async () => {
    const regA = vi.fn(async () => {});
    registerKnownPlugin("@acme/a", regA);

    await autoRegisterPluginComponents([]);
    await autoRegisterPluginComponents(["no-hash-path"]);
    expect(regA).toHaveBeenCalledTimes(0);
  });
});
