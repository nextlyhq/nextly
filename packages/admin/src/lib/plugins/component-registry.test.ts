import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  autoRegisterPluginComponents,
  clearRegistry,
  hasComponent,
  registerComponent,
  registerCoreComponent,
  registerKnownPlugin,
  resetAutoRegistration,
  unregisterComponent,
} from "./component-registry";

describe("autoRegisterPluginComponents — per-module guard", () => {
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

describe("the `core#` namespace is reserved for core's own cards", () => {
  const Card = () => null;

  beforeEach(() => {
    clearRegistry();
    vi.restoreAllMocks();
  });

  it("refuses a plugin registering under it", () => {
    // Core's dashboard cards resolve through `core#…`. A plugin registering the
    // same path would replace the card the dashboard draws for a core widget
    // id, which is a takeover no permission gates -- the widget's definition
    // still says core owns it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerComponent("core#TeamSummary", Card);

    expect(hasComponent("core#TeamSummary")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("still registers an ordinary plugin path", () => {
    // The positive control. A guard that refused everything would satisfy the
    // assertion above while making every plugin component unresolvable.
    registerComponent("@acme/p/admin#Card", Card);
    expect(hasComponent("@acme/p/admin#Card")).toBe(true);
  });

  it("lets CORE register under it", () => {
    // The reservation is a reservation, not a ban: the path has to work for the
    // one caller it exists for, or the cards it protects cannot be drawn.
    registerCoreComponent("core#TeamSummary", Card);
    expect(hasComponent("core#TeamSummary")).toBe(true);
  });

  it("refuses to UNREGISTER a core card", () => {
    // The other route to the same takeover. Registration is guarded, so a
    // plugin that cannot replace the entry can still delete it -- and the core
    // widget's definition still names `core#…`, so the card goes unresolvable
    // rather than merely unregistered.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerCoreComponent("core#TeamSummary", Card);

    expect(unregisterComponent("core#TeamSummary")).toBe(false);
    expect(hasComponent("core#TeamSummary")).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it("still unregisters an ordinary plugin path", () => {
    // The control for that refusal.
    registerComponent("@acme/p/admin#Card", Card);
    expect(unregisterComponent("@acme/p/admin#Card")).toBe(true);
    expect(hasComponent("@acme/p/admin#Card")).toBe(false);
  });

  it("does not refuse a path that merely CONTAINS the prefix", () => {
    // `core#` is a prefix, not a substring: a package legitimately named
    // `@acme/core#X`, or `my-core#X`, is not core's.
    registerComponent("@acme/core#Widget", Card);
    expect(hasComponent("@acme/core#Widget")).toBe(true);
  });
});
