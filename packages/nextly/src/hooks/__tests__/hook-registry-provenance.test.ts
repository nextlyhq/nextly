// The registry records WHO registered a handler, so a config reload can replace
// the app's own handlers without deleting a plugin's.
//
// A plugin may register directly into a collection's namespace — the form
// builder does exactly that on `forms` — and those registrations are not part
// of the config being reloaded. Clearing the namespace wholesale therefore
// deletes contributions the reload knows nothing about and cannot restore,
// which is why the singles registration never clears at all and leaks instead.

import { describe, expect, it, vi } from "vitest";

import { registerHook, unregisterHook } from "../../hooks";
import { createPluginContext } from "../../plugins/plugin-context";
import { HookRegistry, getHookRegistry } from "../hook-registry";
import type { BeforeOperationHandler, HookHandler } from "../types";

const SLUG = "provenance_posts";

/**
 * The services a context resolves. None are reached by the hook methods, but
 * `createPluginContext` resolves them eagerly, so a double that omits one fails
 * at construction rather than at the assertion.
 */
const stubServices = ((name: string) => {
  switch (name) {
    case "logger":
      return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    case "config":
      return { plugins: [] };
    default:
      return {};
  }
}) as unknown as Parameters<typeof createPluginContext>[0];

describe("hook provenance", () => {
  it("keeps a plugin's handler when the config's are replaced", () => {
    const registry = new HookRegistry();
    const fromConfig: HookHandler = ctx => ctx.data;
    const fromPlugin: HookHandler = ctx => ctx.data;

    registry.register("afterRead", SLUG, fromConfig, "code");
    registry.register("afterRead", SLUG, fromPlugin, "plugin:form-builder");

    // The control: both are registered, so "one left" below cannot be mistaken
    // for a registration that never took.
    expect(registry.getHookCount("afterRead", SLUG)).toBe(2);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
    // And it is the plugin's that survived, not merely one of the two.
    expect(registry.getAll().get(`afterRead:${SLUG}`)).toEqual([fromPlugin]);
  });

  it("defaults an unannotated registration to the app, not to its config", () => {
    // `HookRegistry` and `getHookRegistry()` are exported, and this class's own
    // documentation tells an app to call `register` directly. Such a handler is
    // not in the config, so re-registration cannot rebuild it -- defaulting it
    // to the config's ownership would let a reload delete it for good. The two
    // failure modes are not symmetric: a stale handler survives until restart,
    // a deleted one never comes back.
    const registry = new HookRegistry();
    registry.register("beforeCreate", SLUG, ctx => ctx.data);
    registry.registerBeforeOperation(SLUG, ctx => ctx.args);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(1);
    expect(registry.getHookCount("beforeOperation", SLUG)).toBe(1);
  });

  it("still lets the config's own registrar claim its handlers", () => {
    // The counter-test to the default above: if nothing could claim `"code"`,
    // a reload would stop replacing anything at all and the default would look
    // correct while making the feature inert.
    const registry = new HookRegistry();
    registry.register("beforeCreate", SLUG, ctx => ctx.data, "code");

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(0);
  });

  it("reaches beforeOperation, which is stored apart", () => {
    // A partial clear would leave one phase of a reloaded collection stale
    // while every other phase refreshed.
    const registry = new HookRegistry();
    const fromConfig: BeforeOperationHandler = ctx => ctx.args;
    const fromPlugin: BeforeOperationHandler = ctx => ctx.args;

    registry.registerBeforeOperation(SLUG, fromConfig, "code");
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
    registry.register("beforeCreate", SLUG, ctx => ctx.data, "code");
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

    registry.register("beforeCreate", SLUG, shared, "code");
    registry.register("beforeCreate", SLUG, shared, "code");
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(2);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(0);
  });
});

// The registry is only half of it: what a handler ends up owned by is decided
// by the seam its registrant went through. These go through the seams
// production goes through -- a plugin's `ctx.hooks.on`, and the exported
// `registerHook` -- rather than calling `register` with an owner directly,
// because passing the owner by hand is precisely the step that was missing.
describe("hook provenance through the registering seam", () => {
  const pluginDefinition = {
    name: "form-builder",
    version: "1.0.0",
    // Boot-checked core-compatibility range; required on every definition.
    nextly: "*",
  };

  it("attributes ctx.hooks.on to the plugin, not to the config", () => {
    const registry = new HookRegistry();
    const ctx = createPluginContext(stubServices, registry, pluginDefinition);
    const handler: HookHandler = c => c.data;

    ctx.hooks.on("afterRead", SLUG, handler);
    // The control: it registered at all, so "one left" below cannot be a
    // registration that never happened.
    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
  });

  it("attributes ctx.hooks.onBeforeOperation to the plugin as well", () => {
    // Stored apart from every other phase, so it can be missed on its own.
    const registry = new HookRegistry();
    const ctx = createPluginContext(stubServices, registry, pluginDefinition);
    const handler: BeforeOperationHandler = c => c.args;

    ctx.hooks.onBeforeOperation(SLUG, handler);
    expect(registry.getHookCount("beforeOperation", SLUG)).toBe(1);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeOperation", SLUG)).toBe(1);
  });

  it("does not hand a context with no plugin the config's ownership", () => {
    // A context can be built without a plugin, and then there is no name to
    // attribute to. What it must NOT fall back to is the config's ownership:
    // nothing about such a registration is rebuildable from the config, so a
    // reload would delete it with no way to put it back.
    //
    // The proof that a clear still removes anything at all lives in "still lets
    // the config's own registrar claim its handlers" above.
    const registry = new HookRegistry();
    const ctx = createPluginContext(stubServices, registry);

    ctx.hooks.on("afterRead", SLUG, c => c.data);
    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
  });

  it("keeps a handler registered through the public registerHook", () => {
    // An imperative registration is not in the config, so re-registration
    // cannot rebuild it: the module holding the call is evaluated once and a
    // reload never revisits it. Clearing it would end the hook permanently,
    // which is the same failure as deleting a plugin's, one owner over.
    const registry = getHookRegistry();
    registry.clearCollection(SLUG);
    const handler: HookHandler = c => c.data;

    registerHook("beforeCreate", SLUG, handler);
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(1);

    registry.clearCollectionOwnedBy(SLUG, "code");

    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(1);

    unregisterHook("beforeCreate", SLUG, handler);
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(0);
  });

  it("unregisters within the caller's own ownership", () => {
    // The same function can be registered by the config and by a plugin -- a
    // plugin's exported handler the app also lists. Removing the first identity
    // match takes the config's entry, so the plugin's `off` leaves its own
    // handler running and a later selective clear preserves the very
    // registration the plugin asked to remove.
    const registry = new HookRegistry();
    const shared: HookHandler = c => c.data;
    const ctx = createPluginContext(stubServices, registry, pluginDefinition);

    registry.register("beforeCreate", SLUG, shared, "code");
    ctx.hooks.on("beforeCreate", SLUG, shared);
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(2);

    ctx.hooks.off("beforeCreate", SLUG, shared);

    // One left, and it is the config's: clearing config-owned handlers empties
    // the key, which it could not do if the plugin's entry were the survivor.
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(1);
    registry.clearCollectionOwnedBy(SLUG, "code");
    expect(registry.getHookCount("beforeCreate", SLUG)).toBe(0);
  });
});

describe("owner suspension", () => {
  it("does not outlive the handlers it describes", () => {
    // A registry is cleared at shutdown and registered into again in the same
    // process. Suspension left behind would filter out the fresh handlers of a
    // plugin that is enabled this time round, leaving it inert until some later
    // reload happened to recompute the set.
    const registry = new HookRegistry();
    const handler = vi.fn(() => undefined);

    registry.register("afterRead", SLUG, handler, "plugin:form-builder");
    registry.setSuspendedOwners(["plugin:form-builder"]);
    expect(registry.getSuspendedOwners()).toEqual(["plugin:form-builder"]);

    registry.clear();
    registry.register("afterRead", SLUG, handler, "plugin:form-builder");

    expect(registry.getSuspendedOwners()).toEqual([]);
    return registry
      .execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      })
      .then(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
  });
});
