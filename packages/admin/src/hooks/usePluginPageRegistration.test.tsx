/**
 * Plugin pages register after admin-meta loads — later than `useRouter`'s
 * one-time initial `resolveRoute`. A deep link / hard refresh to a plugin page
 * therefore 404'd until this hook emitted a `locationchange` so the router
 * re-resolves against the just-registered routes. These tests pin that emit.
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

describe("usePluginPageRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers pages and emits locationchange so a deep link re-resolves", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    const plugins: PluginMetadata[] = [
      {
        name: "acme",
        collections: [],
        pages: [{ path: "/reports", component: "@acme/x/admin#Reports" }],
      },
    ];

    renderHook(() => usePluginPageRegistration(plugins));

    expect(registerPluginPages).toHaveBeenCalledWith("acme", [
      {
        path: "/reports",
        component: "@acme/x/admin#Reports",
        requiredPermission: undefined,
      },
    ]);
    expect(locationChangeCount(spy)).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("does not emit locationchange when no plugin contributes pages", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    const plugins: PluginMetadata[] = [
      { name: "acme", collections: [], menu: [{ label: "X", to: "/x" }] },
    ];

    renderHook(() => usePluginPageRegistration(plugins));

    expect(clearPluginPages).toHaveBeenCalled();
    expect(locationChangeCount(spy)).toBe(0);
    spy.mockRestore();
  });
});
