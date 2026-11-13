/**
 * The Plugins panel lists no item of a plugin placed standalone: the Page
 * Builder, with its own rail item, has its libraries and its bindings report
 * in its own panel, and the Plugins panel keeps listing the items of plugins
 * that stay there.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding, PluginMetadata } from "@admin/types/branding";

/** The Page Builder as its metadata reaches the admin, placed as it asks. */
function pageBuilder(placement?: string): PluginMetadata {
  return {
    name: "@nextlyhq/plugin-page-builder",
    version: "1.0.0",
    enabled: true,
    ...(placement === undefined ? {} : { placement }),
    appearance: { icon: "Layout", label: "Page Builder" },
    collections: [],
    panel: {
      groups: [
        { id: "library", label: "Library" },
        { id: "checks", label: "Checks" },
      ],
    },
    menu: [
      {
        label: "Patterns",
        to: "/admin/collections/patterns",
        group: "library",
        count: { collection: "patterns" },
      },
      {
        label: "Components",
        to: "/admin/collections/components",
        group: "library",
        count: { collection: "components" },
      },
      {
        label: "Layouts",
        to: "/admin/collections/layouts",
        group: "library",
        count: { collection: "layouts" },
      },
      {
        label: "Templates",
        to: "/admin/collections/templates",
        group: "library",
        count: { collection: "templates" },
      },
      {
        label: "Bindings to fix",
        to: "/admin/plugins/nextlyhq-plugin-page-builder/bindings-to-fix",
        group: "checks",
        badge: { attention: "page-builder/bindings-to-fix" },
      },
    ],
  } as PluginMetadata;
}

/** A plugin that stays in the Plugins section. */
const SEO = {
  name: "@acme/seo",
  version: "1.0.0",
  enabled: true,
  appearance: { label: "SEO" },
  collections: [],
  menu: [{ label: "Redirects", to: "/admin/plugins/acme-seo/redirects" }],
} as PluginMetadata;

const PAGE_BUILDER_ITEMS = [
  "Patterns",
  "Components",
  "Layouts",
  "Templates",
  "Bindings to fix",
];

let branding = { plugins: [] } as unknown as AdminBranding;

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

function renderPluginsPanel(plugins: PluginMetadata[]) {
  branding = { plugins } as unknown as AdminBranding;
  return render(
    <SidebarProvider defaultOpen>
      <SubSidebarContent
        selectedMain="plugins"
        standaloneLabel=""
        contentSearch=""
        onContentSearchChange={() => undefined}
        hasCollectionsSection
        hasSinglesSection
        pluginSearch=""
        onPluginSearchChange={() => undefined}
        isActive={() => false}
        hasPermission={() => true}
        canAccessApiKeys
        canAccessWebhooks
        pluginCollectionsForSection={[]}
        showBuilder
        hasPanel={() => true}
      />
    </SidebarProvider>
  );
}

describe("the Plugins panel beside a standalone Page Builder", () => {
  it("lists none of the Page Builder's items, and keeps the others'", () => {
    renderPluginsPanel([pageBuilder("standalone"), SEO]);
    for (const label of PAGE_BUILDER_ITEMS) {
      expect(screen.queryByRole("link", { name: label }), label).toBeNull();
    }
    expect(screen.queryByText("Page Builder")).toBeNull();
    // The control: a plugin left in Plugins is still listed there.
    expect(
      screen.getByRole("link", { name: "Redirects" }).getAttribute("href")
    ).toBe("/admin/plugins/acme-seo/redirects");
  });

  it("lists the same items there when the plugin is not placed standalone", () => {
    // The control for the case above: identical items, only the placement
    // differs, so their absence there is the placement's doing.
    renderPluginsPanel([pageBuilder(), SEO]);
    for (const label of PAGE_BUILDER_ITEMS) {
      expect(screen.getByRole("link", { name: label }), label).toBeDefined();
    }
  });
});
