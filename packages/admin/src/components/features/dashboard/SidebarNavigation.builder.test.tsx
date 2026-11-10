/**
 * The mobile navigation offers the schema builder only on the server's explicit `true`.
 *
 * The server answers `false` in production, whatever the app's configuration says, and the
 * admin cannot tell production for itself (its copy of `NODE_ENV` was folded at package build),
 * so the answer is the whole of what this drawer has to go on. While the answer is in flight it
 * says nothing, and nothing is not a yes: a production admin on a phone must not be offered the
 * builder for the moment before the answer lands.
 *
 * Entry editing is unaffected: the collections the reader edits entries of stay in the drawer.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding | undefined;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: () => true,
    capabilities: {
      isSuperAdmin: true,
      canViewCollections: true,
      canViewSettings: true,
      canManageSettings: true,
      collections: { posts: { canRead: true } },
    },
  }),
}));
// The content navs read their own queries; what this drawer decides is only whether to draw
// them beside the builder's section, so each stands in as the link it would draw.
vi.mock("./DynamicCollectionNav", () => ({
  DynamicCollectionNav: () => <a href="/admin/collection/posts">Posts</a>,
}));
vi.mock("./DynamicSingleNav", () => ({ DynamicSingleNav: () => null }));
vi.mock("./DynamicPluginNav", () => ({ DynamicPluginNav: () => null }));
vi.mock("./DynamicCustomGroupNav", () => ({
  DynamicCustomGroupNav: () => null,
}));
vi.mock("./PluginMenuItems", () => ({ PluginMenuItems: () => null }));
vi.mock("./DynamicPluginSectionItems", () => ({
  DynamicPluginSectionItems: () => null,
}));

import { SidebarNavigation } from "@admin/components/features/dashboard/SidebarNavigation";
import { SidebarProvider } from "@admin/components/layout/sidebar";
import { SIDEBAR_NAVIGATION } from "@admin/constants/navigation";

const BUILDER_PAGES = [
  ROUTES.BUILDER_COLLECTIONS,
  ROUTES.BUILDER_SINGLES,
  ROUTES.BUILDER_FIELD_GROUPS,
];

function renderDrawerNav() {
  return render(
    <SidebarProvider defaultOpen>
      <SidebarNavigation
        items={SIDEBAR_NAVIGATION}
        isActive={() => false}
        hideLabels={["Main"]}
      />
    </SidebarProvider>
  );
}

/** Every builder page the drawer links to. */
function builderLinks(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a[href]"), a =>
    a.getAttribute("href")
  ).filter((href): href is string =>
    BUILDER_PAGES.includes(href as (typeof BUILDER_PAGES)[number])
  );
}

afterEach(() => {
  mockBranding = undefined;
});

describe("the mobile navigation and the schema builder", () => {
  // The positive control: the drawer does draw the builder's pages, so their absence below is
  // the drawer's decision and not a selector that finds nothing.
  it("offers every builder page where the server says the builder is on", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    const { container } = renderDrawerNav();
    expect(builderLinks(container).sort()).toEqual([...BUILDER_PAGES].sort());
  });

  it("offers no builder page where the server says it is off, as in production", () => {
    mockBranding = { plugins: [], showBuilder: false } as AdminBranding;
    const { container } = renderDrawerNav();
    expect(builderLinks(container)).toEqual([]);
  });

  it("keeps the collections whose entries the reader edits where the builder is off", () => {
    mockBranding = { plugins: [], showBuilder: false } as AdminBranding;
    const { container } = renderDrawerNav();
    expect(
      container.querySelector('a[href="/admin/collection/posts"]')
    ).not.toBeNull();
  });

  it.each([
    ["the answer is in flight", {} as AdminBranding],
    ["no answer is held", undefined],
  ])("offers no builder page while %s", (_label, branding) => {
    mockBranding = branding;
    const { container } = renderDrawerNav();
    expect(builderLinks(container)).toEqual([]);
  });
});
