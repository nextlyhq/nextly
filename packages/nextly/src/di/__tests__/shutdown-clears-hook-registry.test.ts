// The hook registry outlives the DI container, so clearing services has to
// clear it too.
//
// Handlers are registered from config on every init. A registry that survives a
// shutdown therefore hands the next instance in the same process a second copy
// of every configured handler, running alongside the dead instance's own -- the
// same hazard the webhook recording policy and activation are cleared for.

import { describe, expect, it } from "vitest";

import { clearServices } from "../register";
import { getHookRegistry, resetHookRegistry } from "../../hooks/hook-registry";
import type { HookHandler } from "../../hooks/types";

const SLUG = "shutdown_registry_posts";

describe("clearing services clears the hook registry", () => {
  it("a hook registered before the clear is gone after it", () => {
    resetHookRegistry();
    const handler: HookHandler = ctx => ctx.data;
    getHookRegistry().register("beforeCreate", SLUG, handler);

    // The control: without it, "gone after the clear" cannot be told apart from
    // a registration that never took.
    expect(getHookRegistry().hasHooks("beforeCreate", SLUG)).toBe(true);

    clearServices();

    expect(getHookRegistry().hasHooks("beforeCreate", SLUG)).toBe(false);
  });

  it("re-registering after a clear runs the handler once, not twice", async () => {
    // What the leak actually costs. Registration appends, so a second init
    // against a registry that was never cleared runs every handler twice per
    // operation -- doubling side effects, not just wasting a call.
    resetHookRegistry();
    let runs = 0;
    const handler: HookHandler = ctx => {
      runs++;
      return ctx.data;
    };

    getHookRegistry().register("beforeCreate", SLUG, handler);
    clearServices();
    getHookRegistry().register("beforeCreate", SLUG, handler);

    await getHookRegistry().execute("beforeCreate", {
      collection: SLUG,
      operation: "create",
      data: { title: "t" },
      context: {},
    });

    expect(runs).toBe(1);
    resetHookRegistry();
  });
});
