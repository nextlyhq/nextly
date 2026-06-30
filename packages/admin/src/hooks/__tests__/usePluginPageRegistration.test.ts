import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearPluginPages,
  matchPluginPage,
} from "@admin/lib/plugins/plugin-route-registry";
import type { PluginMetadata } from "@admin/types/branding";

import { usePluginPageRegistration } from "../usePluginPageRegistration";

const autoRegister = vi.fn();
vi.mock("@admin/lib/plugins/component-registry", () => ({
  autoRegisterPluginComponents: (paths: string[]) => autoRegister(paths),
}));

afterEach(() => {
  clearPluginPages();
  vi.clearAllMocks();
});

describe("usePluginPageRegistration", () => {
  it("registers plugin pages from branding into the route registry", () => {
    renderHook(() =>
      usePluginPageRegistration([
        {
          name: "@acme/p",
          collections: [],
          pages: [
            {
              path: "reports",
              component: "@acme/p/admin#Reports",
              requiredPermission: "read-reports",
            },
          ],
        },
      ] satisfies PluginMetadata[])
    );

    expect(matchPluginPage("/admin/plugins/acme-p/reports")).toMatchObject({
      component: "@acme/p/admin#Reports",
      requiredPermission: "read-reports",
    });
    expect(autoRegister).toHaveBeenCalledWith(
      expect.arrayContaining(["@acme/p/admin#Reports"])
    );
  });

  it("clears stale pages when plugins change", () => {
    const { rerender } = renderHook(
      ({ plugins }: { plugins: PluginMetadata[] }) =>
        usePluginPageRegistration(plugins),
      {
        initialProps: {
          plugins: [
            {
              name: "@acme/p",
              collections: [],
              pages: [{ path: "x", component: "@acme/p/admin#X" }],
            },
          ] satisfies PluginMetadata[],
        },
      }
    );
    expect(matchPluginPage("/admin/plugins/acme-p/x")).toBeDefined();

    rerender({ plugins: [] });
    expect(matchPluginPage("/admin/plugins/acme-p/x")).toBeUndefined();
  });

  it("feeds header.slot paths into auto-registration", () => {
    renderHook(() =>
      usePluginPageRegistration([
        {
          name: "@acme/plugin-toolbar",
          collections: [],
          header: { slot: "@acme/plugin-toolbar/admin#ToolbarButton" },
        },
      ] satisfies PluginMetadata[])
    );
    expect(autoRegister).toHaveBeenCalledWith(
      expect.arrayContaining(["@acme/plugin-toolbar/admin#ToolbarButton"])
    );
  });

  it("falls back to the deprecated headerSlot path", () => {
    renderHook(() =>
      usePluginPageRegistration([
        {
          name: "@acme/p",
          collections: [],
          headerSlot: "@acme/p/admin#Badge",
        },
      ] satisfies PluginMetadata[])
    );
    expect(autoRegister).toHaveBeenCalledWith(
      expect.arrayContaining(["@acme/p/admin#Badge"])
    );
  });
});
