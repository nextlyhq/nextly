/**
 * The desktop sidebar's panels list the plugins' own menu items
 * (`contributes.admin.menu`), as the narrow sidebar does: a plugin's pages of
 * its own, such as a library, are reached from the panel its items live in,
 * and the panel's search filters them with its other entries.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";
import type { ApiCollection } from "@admin/types/entities";

const branding: AdminBranding = {
  plugins: [
    {
      name: "@nextlyhq/plugin-page-builder",
      appearance: { label: "Page Builder" },
      collections: [],
      menu: [
        { label: "Patterns", to: "/admin/collections/patterns" },
        { label: "Components", to: "/admin/collections/components" },
        {
          label: "Reports",
          to: "/admin/plugins/r/reports",
          children: [{ label: "Weekly", to: "/admin/plugins/r/weekly" }],
        },
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
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useCollections")
  >()),
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
        hasPanel={() => true}
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
    // Under the plugin's own name, apart from the panel's plugin management.
    expect(screen.getByText("Page Builder")).toBeDefined();
  });

  it("filters them by the panel's search, as its other entries are", () => {
    renderPlugins("comp");
    expect(screen.getByRole("link", { name: "Components" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Patterns" })).toBeNull();
  });

  it("opens a branch on the child a search matched", () => {
    // Only the child matches: closed, the branch would show its parent's
    // label alone and hide the result.
    renderPlugins("week");
    expect(screen.getByRole("link", { name: "Weekly" })).toBeDefined();
  });
});

describe("a plugin's own panel", () => {
  it("names its menu by the plugin without repeating the panel's title over it", () => {
    render(
      <SidebarProvider defaultOpen>
        <SubSidebarContent
          selectedMain="standalone-acme"
          standaloneLabel="Acme"
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
          pluginCollectionsForSection={
            [
              { id: "c1", name: "forms", labels: { plural: "Forms" } },
            ] as unknown as ApiCollection[]
          }
          showBuilder
          hasPanel={() => true}
        />
      </SidebarProvider>
    );

    // The panel's own title band says "Acme" already; the content under it
    // does not say it a second time.
    expect(screen.queryByText("Acme")).toBeNull();
    // Assistive technology still hears whose menu it is.
    const nav = screen.getByRole("navigation", { name: "Acme" });
    expect(nav).toContainElement(screen.getByRole("link", { name: "Forms" }));
  });

  it("draws its collections with the icon every panel draws for a collection", () => {
    render(
      <SidebarProvider defaultOpen>
        <SubSidebarContent
          selectedMain="standalone-forms"
          standaloneLabel="Forms"
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
          pluginCollectionsForSection={
            [
              { id: "c1", name: "forms", labels: { plural: "Forms" } },
              {
                id: "c2",
                name: "submissions",
                labels: { plural: "Submissions" },
                admin: { icon: "Archive" },
              },
            ] as unknown as ApiCollection[]
          }
          showBuilder
          hasPanel={() => true}
        />
      </SidebarProvider>
    );

    const iconOf = (name: string) =>
      screen.getByRole("link", { name }).querySelector("svg");
    // No icon set: the list, muted, as the Content panel draws one.
    expect(iconOf("Forms")).toHaveClass("lucide-list", "text-muted-foreground");
    expect(iconOf("Forms")).not.toHaveClass("lucide-database");
    // A set icon is kept.
    expect(iconOf("Submissions")).toHaveClass("lucide-archive");
  });
});
