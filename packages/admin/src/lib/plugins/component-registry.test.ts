import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as publicSurface from "./component-registry";

import {
  clearRegistry,
  getComponent,
  hasComponent,
  registerComponent,
  unregisterComponent,
} from "./component-registry";
import { registerCoreComponent } from "./component-registry-internal";

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

describe("the privileged writer is not on the published subpath", () => {
  it("is absent from `component-registry`, which the package exports", () => {
    // `@nextlyhq/admin/lib/component-registry` is a published subpath, so
    // anything it exports a plugin can import. `registerCoreComponent` skips
    // the `core#` reservation by design -- exported there it WAS the documented
    // way around the guard beside it, and the reservation was decoration.
    //
    // Asserted on the module's own surface rather than on a call, because the
    // property is what the package hands out, not what any one caller does.
    expect(publicSurface).not.toHaveProperty("registerCoreComponent");
    expect(publicSurface).not.toHaveProperty("writeComponent");
    expect(publicSurface).not.toHaveProperty("componentRegistry");
  });

  it("still exports the guarded API it is meant to", () => {
    // The control. A subpath that exported nothing would satisfy the assertion
    // above while breaking every plugin.
    expect(publicSurface).toHaveProperty("registerComponent");
    expect(publicSurface).toHaveProperty("getComponent");
  });
});

describe("bulk clearing cannot take core's components with it", () => {
  const Card = () => null;

  it("leaves a reserved entry standing", () => {
    // The third route into the same map. Registration and unregistration both
    // refuse `core#`, so a plugin able to call `clearRegistry` could still
    // remove what it could not touch directly -- and core registers once, when
    // the grid's module is evaluated, so nothing puts them back.
    registerCoreComponent("core#TeamSummary", Card);
    registerComponent("@acme/p/admin#Card", Card);

    clearRegistry();

    expect(hasComponent("core#TeamSummary")).toBe(true);
  });

  it("still clears everything else", () => {
    // The control. A clear that preserved everything would satisfy the
    // assertion above while breaking every test that relies on a clean map.
    registerCoreComponent("core#TeamSummary", Card);
    registerComponent("@acme/p/admin#Card", Card);

    clearRegistry();

    expect(hasComponent("@acme/p/admin#Card")).toBe(false);
  });
});

describe("a path nothing registered", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is named in a warning in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getComponent("@acme/missing/admin#Gone")).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      '"@acme/missing/admin#Gone"'
    );
  });

  it("is not warned about in production, where the caller's fallback is all a visitor sees", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getComponent("@acme/missing/admin#Gone")).toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });
});
