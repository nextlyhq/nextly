/**
 * Plugin pages register after admin-meta loads — later than `useRouter`'s
 * one-time initial `resolveRoute`. A deep link / hard refresh to a plugin page
 * therefore 404'd until this hook emitted a `locationchange` so the router
 * re-resolves against the just-registered routes. Admin-meta also refetches
 * periodically, so these tests pin both halves of the emit: it fires when the
 * registered route set actually changes (added or removed), and stays quiet
 * when an unrelated branding field changed.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPluginPages,
  registerPluginPages,
} from "@admin/lib/plugins/plugin-route-registry";
import type { PluginMetadata } from "@admin/types/branding";

import { usePluginPageRegistration } from "./usePluginPageRegistration";

// The registry + component-registry internals have their own tests; here we
// only care about the routing side-effect (the locationchange emit).
vi.mock("@admin/lib/plugins/plugin-route-registry", () => ({
  registerPluginPages: vi.fn(),
  clearPluginPages: vi.fn(),
}));
vi.mock("@admin/lib/plugins/component-registry", () => ({
  autoRegisterPluginComponents: vi.fn(),
}));

function locationChangeCount(
  spy: ReturnType<typeof vi.spyOn<typeof window, "dispatchEvent">>
): number {
  return spy.mock.calls.filter(
    ([event]) => event instanceof Event && event.type === "locationchange"
  ).length;
}

/** A fresh object each call, so rerenders get a new identity, same content. */
function pluginWithPage(): PluginMetadata {
  return {
    name: "acme",
    collections: [],
    pages: [{ path: "/reports", component: "@acme/x/admin#Reports" }],
  };
}

function renderWith(plugins: PluginMetadata[] | undefined) {
  return renderHook(
    ({ plugins: p }: { plugins: PluginMetadata[] | undefined }) =>
      usePluginPageRegistration(p),
    { initialProps: { plugins } }
  );
}

describe("usePluginPageRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers pages and emits locationchange so a deep link re-resolves", () => {
    const spy = vi.spyOn(window, "dispatchEvent");

    renderWith([pluginWithPage()]);

    expect(registerPluginPages).toHaveBeenCalledWith("acme", [
      {
        path: "/reports",
        component: "@acme/x/admin#Reports",
        requiredPermission: undefined,
      },
    ]);
    expect(locationChangeCount(spy)).toBe(1);
    spy.mockRestore();
  });

  it("does not emit locationchange when no plugin contributes pages", () => {
    const spy = vi.spyOn(window, "dispatchEvent");

    renderWith([
      { name: "acme", collections: [], menu: [{ label: "X", to: "/x" }] },
    ]);

    expect(clearPluginPages).toHaveBeenCalled();
    expect(locationChangeCount(spy)).toBe(0);
    spy.mockRestore();
  });

  it("does not re-emit when admin-meta changes but the plugin routes are identical", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    const { rerender } = renderWith([pluginWithPage()]);
    expect(locationChangeCount(spy)).toBe(1);

    // A periodic admin-meta refetch that changed some unrelated field hands
    // down a new array identity carrying the same pages: no re-resolution.
    rerender({ plugins: [pluginWithPage()] });

    expect(locationChangeCount(spy)).toBe(1);
    spy.mockRestore();
  });

  it("emits locationchange when a plugin's pages go away so the stale route stops resolving", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    const { rerender } = renderWith([pluginWithPage()]);
    expect(locationChangeCount(spy)).toBe(1);

    // The plugin is still present but no longer contributes pages.
    rerender({ plugins: [{ name: "acme", collections: [] }] });

    expect(locationChangeCount(spy)).toBe(2);
    spy.mockRestore();
  });

  it("emits locationchange when plugins go away entirely", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    const { rerender } = renderWith([pluginWithPage()]);
    expect(locationChangeCount(spy)).toBe(1);

    rerender({ plugins: undefined });

    expect(locationChangeCount(spy)).toBe(2);
    spy.mockRestore();
  });
});
