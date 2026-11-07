/**
 * The desktop sidebar's panels list the plugins' own menu items
 * (`contributes.admin.menu`), as the narrow sidebar does: a plugin's pages of
 * its own, such as a library, are reached from the panel its items live in,
 * and the panel's search filters them with its other entries.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const branding: AdminBranding = {
  plugins: [
    {
      name: "@nextlyhq/plugin-page-builder",
      collections: [],
      menu: [
        { label: "Patterns", to: "/admin/collections/patterns" },
        { label: "Components", to: "/admin/collections/components" },
      ],
    },
  ],
} as AdminBranding;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: () => true,
    capabilities: {
      canViewCollections: true,
      canManageSettings: true,
      isSuperAdmin: false,
      collections: {},
    },
  }),
}));
vi.mock("@admin/hooks/queries", () => ({
  useCollections: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  }),
}));

import { SidebarProvider } from "@admin/components/layout/sidebar";

import { SubSidebarContent } from "../SubSidebarContent";

afterEach(cleanup);

function renderPlugins(search: string) {
  return render(
    <SidebarProvider defaultOpen>
      <SubSidebarContent
        selectedMain="plugins"
        standaloneLabel=""
        contentSearch=""
        onContentSearchChange={() => undefined}
        hasCollectionsSection
        hasSinglesSection
        pluginSearch={search}
        onPluginSearchChange={() => undefined}
        isActive={() => false}
        hasPermission={() => true}
        canAccessApiKeys
        canAccessWebhooks
        pluginCollectionsForSection={[]}
        showBuilder
      />
    </SidebarProvider>
  );
}

describe("the desktop Plugins panel", () => {
  it("lists the plugins' menu items placed in Plugins", () => {
    renderPlugins("");
    expect(
      screen.getByRole("link", { name: "Patterns" }).getAttribute("href")
    ).toBe("/admin/collections/patterns");
    expect(screen.getByRole("link", { name: "Components" })).toBeDefined();
  });

  it("filters them by the panel's search, as its other entries are", () => {
    renderPlugins("comp");
    expect(screen.getByRole("link", { name: "Components" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Patterns" })).toBeNull();
  });
});
