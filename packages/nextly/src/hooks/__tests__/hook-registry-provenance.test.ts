// The registry records WHO registered a handler, so a config reload can replace
// the app's own handlers without deleting a plugin's.
//
// A plugin may register directly into a collection's namespace — the form
// builder does exactly that on `forms` — and those registrations are not part
// of the config being reloaded. Clearing the namespace wholesale therefore
// deletes contributions the reload knows nothing about and cannot restore,
// which is why the singles registration never clears at all and leaks instead.

import { describe, expect, it, vi } from "vitest";

import { HookRegistry } from "../hook-registry";
import type { BeforeOperationHandler, HookHandler } from "../types";

const SLUG = "provenance_posts";

describe("hook provenance", () => {
  it("keeps a plugin's handler when the config's are replaced", () => {
    const registry = new HookRegistry();
    const fromConfig: HookHandler = ctx => ctx.data;
    const fromPlugin: HookHandler = ctx => ctx.data;

    registry.register("afterRead", SLUG, fromConfig);
    registry.register("afterRead", SLUG, fromPlugin, "plugin:form-builder");

    // The control: both are registered, so "one left" below cannot be mistaken
    // for a registration that never took.
    expect(registry.getHookCount("afterRead", SLUG)).toBe(2);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
    // And it is the plugin's that survived, not merely one of the two.
    expect(registry.getAll().get(`afterRead:${SLUG}`)).toEqual([fromPlugin]);
  });

  it("defaults an unannotated registration to the app's own config", () => {
    // Every existing caller registers without naming an owner, and those are
    // the app's declarations — so the default has to be the one a reload
    // replaces, or a reload would silently stop replacing anything.
    const registry = new HookRegistry();
    registry.register("beforeCreate", SLUG, ctx => ctx.data);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(0);
  });

  it("reaches beforeOperation, which is stored apart", () => {
    // A partial clear would leave one phase of a reloaded collection stale
    // while every other phase refreshed.
    const registry = new HookRegistry();
    const fromConfig: BeforeOperationHandler = ctx => ctx.args;
    const fromPlugin: BeforeOperationHandler = ctx => ctx.args;

    registry.registerBeforeOperation(SLUG, fromConfig);
    registry.registerBeforeOperation(SLUG, fromPlugin, "plugin:seo");
    expect(registry.getHookCount("beforeOperation", SLUG)).toBe(2);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeOperation", SLUG)).toBe(1);
  });

  it("still runs the surviving handler after a clear", async () => {
    // Counting what remains is not the same as it still being wired up: the
    // entries are unwrapped on the execution path, so a mistake there would
    // leave a handler that is present and never called.
    const registry = new HookRegistry();
    const pluginRan = vi.fn();
    registry.register("beforeCreate", SLUG, ctx => ctx.data);
    registry.register(
      "beforeCreate",
      SLUG,
      ctx => {
        pluginRan();
        return ctx.data;
      },
      "plugin:form-builder"
    );

    registry.clearCollectionOwnedBy(SLUG, "code");
    await registry.execute("beforeCreate", {
      collection: SLUG,
      operation: "create",
      data: { title: "t" },
      context: {},
    });

    expect(pluginRan).toHaveBeenCalledTimes(1);
  });

  it("removes the same function twice when it was registered twice", () => {
    // Provenance is per REGISTRATION, not per function: the same handler can be
    // listed twice in one array, or shared between two phases, and a design
    // keyed on the function would collapse those into one entry.
    const registry = new HookRegistry();
    const shared: HookHandler = ctx => ctx.data;

    registry.register("beforeCreate", SLUG, shared);
    registry.register("beforeCreate", SLUG, shared);
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(2);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(0);
  });
});
