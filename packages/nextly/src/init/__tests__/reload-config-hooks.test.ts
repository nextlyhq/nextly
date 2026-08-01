// A config reload has to refresh the hooks the config declares. The registry
// holds the function objects the first boot registered, so without this an
// edited hook keeps its old body and a deleted one keeps firing until the
// process restarts.
//
// The resolver here hands back no adapter, so the reload abandons at the DI
// probe and every schema path below it is skipped. That is the point rather
// than a shortcut: a hook edit changes no table, so the reload it triggers finds
// nothing to apply, and re-registration gated on a successful apply would never
// run on the one edit that needs it most.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getHookRegistry } from "../../hooks/hook-registry";
import { createPluginContext } from "../../plugins/plugin-context";

const { loadConfigSpy, clearConfigCacheSpy } = vi.hoisted(() => ({
  loadConfigSpy: vi.fn(),
  clearConfigCacheSpy: vi.fn(),
}));

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: loadConfigSpy,
  clearConfigCache: clearConfigCacheSpy,
}));

const SLUG = "reload_posts";
const SINGLE_SLUG = "reload_settings";
const SINGLE_KEY = `single:${SINGLE_SLUG}`;

/** No service resolves, so the reload abandons directly after the hook work. */
const noServices = () => undefined;

/**
 * The services a plugin context resolves at construction. None are reached by
 * the hook methods, but they are resolved eagerly.
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

async function reload(config: unknown): Promise<void> {
  loadConfigSpy.mockResolvedValue({ config });
  const { reloadNextlyConfig } = await import("../reload-config");
  await reloadNextlyConfig({ resolver: noServices });
}

describe("config reload — declared hooks", () => {
  beforeEach(() => {
    loadConfigSpy.mockReset();
    clearConfigCacheSpy.mockReset();
    const registry = getHookRegistry();
    registry.clearCollection(SLUG);
    registry.clearCollection(SINGLE_KEY);
  });

  it("replaces a collection hook the config changed", async () => {
    const registry = getHookRegistry();
    const original = vi.fn(() => undefined);
    const edited = vi.fn(() => undefined);

    await reload({
      collections: [{ slug: SLUG, hooks: { afterRead: [original] } }],
    });
    // The control: the first reload registered, so the assertions below are
    // about replacement rather than about nothing ever arriving.
    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

    await reload({
      collections: [{ slug: SLUG, hooks: { afterRead: [edited] } }],
    });

    // One, not two: appending would leave the previous handler in place, which
    // is the shape of the bug -- the edited hook appears to work while the
    // handler the author deleted goes on running ahead of it.
    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
    await registry.execute("afterRead", {
      collection: SLUG,
      operation: "read",
      data: {},
      context: {},
    });
    expect(edited).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
  });

  it("stops running a hook the config removed", async () => {
    const registry = getHookRegistry();
    const removed = vi.fn(() => undefined);

    await reload({
      collections: [{ slug: SLUG, hooks: { afterRead: [removed] } }],
    });
    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

    await reload({ collections: [{ slug: SLUG }] });

    expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
  });

  it("keeps a plugin's handler on the same collection", async () => {
    // The hazard the whole selective clear exists for: the form builder
    // registers straight into a collection's namespace, its `init` belongs to
    // service registration rather than to the reload, and nothing else knows
    // how to put the handler back.
    const registry = getHookRegistry();
    const ctx = createPluginContext(stubServices, registry, {
      name: "form-builder",
      version: "1.0.0",
      // Boot-checked core-compatibility range; required on every definition.
      nextly: "*",
    });
    const fromPlugin = vi.fn(() => undefined);
    ctx.hooks.on("afterRead", SLUG, fromPlugin);

    await reload({
      collections: [{ slug: SLUG, hooks: { afterRead: [() => undefined] } }],
    });

    expect(registry.getHookCount("afterRead", SLUG)).toBe(2);
    await registry.execute("afterRead", {
      collection: SLUG,
      operation: "read",
      data: {},
      context: {},
    });
    expect(fromPlugin).toHaveBeenCalledTimes(1);
  });

  it("refreshes a single's hooks under its own namespace", async () => {
    // Singles register under `single:<slug>` and were the path that avoided the
    // wipe by never clearing at all, so a reload that covers only collections
    // leaves them exactly as stale as before.
    const registry = getHookRegistry();
    const original = vi.fn(() => undefined);
    const edited = vi.fn(() => undefined);

    await reload({
      singles: [{ slug: SINGLE_SLUG, hooks: { afterRead: [original] } }],
    });
    expect(registry.getHookCount("afterRead", SINGLE_KEY)).toBe(1);

    await reload({
      singles: [{ slug: SINGLE_SLUG, hooks: { afterRead: [edited] } }],
    });

    expect(registry.getHookCount("afterRead", SINGLE_KEY)).toBe(1);
    await registry.execute("afterRead", {
      collection: SINGLE_KEY,
      operation: "read",
      data: {},
      context: {},
    });
    expect(edited).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
  });

  it("keeps a plugin's handler on a single too", async () => {
    // The singles path clears its own namespace, and a plugin can register into
    // `single:<slug>` exactly as it can into a collection's. Covered separately
    // because the collection and single clears are two call sites: making one
    // selective and leaving the other wholesale reads as done and still wipes.
    const registry = getHookRegistry();
    const ctx = createPluginContext(stubServices, registry, {
      name: "form-builder",
      version: "1.0.0",
      // Boot-checked core-compatibility range; required on every definition.
      nextly: "*",
    });
    const fromPlugin = vi.fn(() => undefined);
    ctx.hooks.on("afterRead", SINGLE_KEY, fromPlugin);

    await reload({
      singles: [{ slug: SINGLE_SLUG, hooks: { afterRead: [() => undefined] } }],
    });

    expect(registry.getHookCount("afterRead", SINGLE_KEY)).toBe(2);
    await registry.execute("afterRead", {
      collection: SINGLE_KEY,
      operation: "read",
      data: {},
      context: {},
    });
    expect(fromPlugin).toHaveBeenCalledTimes(1);
  });

  it("does not register hooks for a disabled plugin's entities", async () => {
    // A disabled plugin's entities stay in the config so the schema stays
    // deterministic, but its runtime behaviour must not run. Boot filters them
    // out; a reload that skipped the filter would switch a disabled plugin back
    // on at the first config save.
    const registry = getHookRegistry();
    const fromDisabledPlugin = vi.fn(() => undefined);

    await reload({
      plugins: [
        {
          name: "disabled-plugin",
          enabled: false,
          contributes: { collections: [{ slug: SLUG }] },
        },
      ],
      collections: [{ slug: SLUG, hooks: { afterRead: [fromDisabledPlugin] } }],
    });

    expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
  });

  it("still registers an ENABLED plugin's entities", async () => {
    // The mirror of the test above. Without it, a filter that excluded every
    // plugin-contributed entity would look correct.
    const registry = getHookRegistry();
    const fromEnabledPlugin = vi.fn(() => undefined);

    await reload({
      plugins: [
        {
          name: "enabled-plugin",
          enabled: true,
          contributes: { collections: [{ slug: SLUG }] },
        },
      ],
      collections: [{ slug: SLUG, hooks: { afterRead: [fromEnabledPlugin] } }],
    });

    expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
  });
});
