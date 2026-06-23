/**
 * B4 — live admin-UI render test for plugin contributions.
 *
 * Mounts real plugin admin contributions through the actual render path (not
 * isolated unit pieces): the sidebar **menu** (RBAC-gated via
 * `useCurrentUserPermissions`), a custom **page** via `PluginPageHost` →
 * `PluginSlot` → component registry, and the **error boundary** (D53) containing
 * a throwing plugin component without taking down the surrounding admin.
 *
 * The **settings** contribution mount is covered separately in
 * `src/pages/dashboard/plugins/[slug].test.tsx`; together these prove all three
 * declarative admin contribution types render live.
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@admin/components/layout/sidebar";
import { PluginPageHost } from "@admin/components/shared/plugin-page-host";
import {
  clearRegistry,
  registerComponents,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { renderWithProviders } from "./utils";

// Branding carries the plugin's declarative menu; read lazily so each test can
// set it before render (vi.mock factory closes over the mutable ref).
let mockBranding: AdminBranding | undefined;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));

// The test "user" has read-forms but NOT manage-secret.
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (p: string) => p === "read-forms",
  }),
}));

import { PluginMenuItems } from "@admin/components/features/dashboard/PluginMenuItems";

afterEach(() => {
  clearRegistry();
  mockBranding = undefined;
  vi.restoreAllMocks();
});

describe("plugin admin contributions (live render, B4)", () => {
  it("renders only permission-granted menu items", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          version: "1.0.0",
          collections: [],
          menu: [
            { label: "Forms", to: "/forms", requiredPermission: "read-forms" },
            {
              label: "Secret",
              to: "/secret",
              requiredPermission: "manage-secret",
            },
          ],
        },
      ],
    } as AdminBranding;

    renderWithProviders(
      <SidebarProvider>
        <PluginMenuItems isActive={() => false} />
      </SidebarProvider>
    );

    expect(screen.getByText("Forms")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("mounts a plugin page through PluginPageHost → registry", () => {
    registerComponents({
      "@acme/p/admin#Page": () => <div>plugin page body</div>,
    });

    renderWithProviders(<PluginPageHost componentPath="@acme/p/admin#Page" />);

    expect(screen.getByText("plugin page body")).toBeInTheDocument();
  });

  it("contains a throwing plugin page behind the error boundary (D53)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerComponents({
      "@acme/p/admin#Boom": () => {
        throw new Error("boom");
      },
    });

    renderWithProviders(
      <div>
        <span>sibling stays</span>
        <PluginPageHost componentPath="@acme/p/admin#Boom" />
      </div>
    );

    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    // The boundary is contained — sibling admin UI keeps rendering.
    expect(screen.getByText("sibling stays")).toBeInTheDocument();
  });
});
