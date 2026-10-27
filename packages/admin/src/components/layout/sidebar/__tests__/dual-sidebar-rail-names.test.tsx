/**
 * Every rail control carries its label as its accessible name.
 *
 * The rail shows an icon alone; the label is reachable by pointer only, inside
 * a tooltip that mounts on hover. Assistive technology cannot hover, so before
 * this property held, a screen reader announced the rail as a run of unnamed
 * links and buttons — the destination was invisible to exactly the people the
 * name exists for. The name is asserted through the ROLE query's `name`
 * option, because that is the accessible-name computation: an icon-only
 * control with its label only in an unmounted tooltip matches no name, so a
 * plausible broken implementation fails here rather than passing vacuously.
 *
 * The names are asserted as fixed strings, not read back from the item list:
 * deriving the expectation from the same list the component reads would make
 * the assertion true by construction, and a stale copy of a label would pass.
 * The second render pins the harder half of the property — that the name
 * FOLLOWS the label — by giving the rail a plugin-supplied, non-English label
 * no fixed copy in the component could anticipate.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@nextlyhq/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";
import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";

vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({
    pathname: "/admin",
    route: { searchParams: new URLSearchParams() },
    isHydrated: true,
  }),
}));
vi.mock("@admin/context/providers/MediaProvider", () => ({
  useMediaContext: () => ({ isFolderTreeVisible: false }),
}));
vi.mock("@admin/hooks/queries", () => ({
  useCollections: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  }),
  useSingles: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));
vi.mock("@admin/hooks/useSidebarNavigation", () => ({
  useSidebarNavigation: () => ({ isActive: () => false }),
}));
vi.mock("../SubSidebarPanel", () => ({
  SubSidebarPanel: () => null,
}));
vi.mock("../../ChromeSuppression", () => ({
  useSuppressedChrome: () => new Set<string>(),
}));

let branding: { showBuilder?: boolean; plugins?: PluginMetadata[] } | undefined;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));

/**
 * Capabilities are derived the way the product derives them, from a slug list,
 * rather than hand-built: a hand-built literal asserts against a shape nothing
 * produces and keeps passing after the real derivation changes.
 */
let permissions: {
  slugs: string[];
  isSuperAdmin: boolean;
};
vi.mock("@admin/hooks/useCurrentUserPermissions", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("@admin/hooks/useCurrentUserPermissions")
    >();
  return {
    ...actual,
    useCurrentUserPermissions: () => {
      const slugs = permissions.isSuperAdmin ? [] : permissions.slugs;
      return {
        capabilities: buildCapabilities(slugs, permissions.isSuperAdmin),
        permissions: slugs,
        hasPermission: (slug: string) =>
          permissions.isSuperAdmin || slugs.includes(slug),
        isLoading: false,
        error: null,
      };
    },
  };
});

import { DualSidebar } from "../DualSidebar";

beforeEach(() => {
  branding = {
    showBuilder: true,
    plugins: [
      // No collections: the item opens the panel, exercising the rail's
      // button arm beside the link arm.
      {
        name: "notes",
        placement: "standalone",
        collections: [],
        appearance: { label: "Notes" },
      },
    ],
  };
  permissions = { slugs: [], isSuperAdmin: true };
});

afterEach(cleanup);

/** The super-admin rail with no collections: every section a grant can open. */
describe("the icon rail's accessible names", () => {
  it("names every rail control by its label", () => {
    render(
      <TooltipProvider>
        <DualSidebar />
      </TooltipProvider>
    );

    // Links: destinations with a route of their own. Plugins resolves to the
    // installed-plugins page for a reader who can manage settings, so it is a
    // link here too — the rail has no `#` item left in this fixture.
    for (const name of [
      "Dashboard",
      "Media Library",
      "Releases",
      "Translations",
      "Plugins",
      "Settings",
      "Builders",
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    // The one item with no destination of its own: a standalone plugin that
    // declares no collections opens the panel beside the rail instead, which
    // renders the button arm of the rail — the name must hold on both arms.
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();
  });

  it("follows a label the rail did not define, wherever the list takes it", () => {
    branding = {
      showBuilder: true,
      plugins: [
        {
          name: "books",
          placement: "standalone",
          collections: ["books"],
          appearance: { label: "Livres" },
        },
      ],
    };
    permissions = { slugs: ["read-books"], isSuperAdmin: false };

    render(
      <TooltipProvider>
        <DualSidebar />
      </TooltipProvider>
    );

    // A standalone plugin supplies its own label, in any language its plugin
    // ships: the name must be that label, not an English copy of the slug.
    expect(screen.getByRole("link", { name: "Livres" })).toBeInTheDocument();
    // The ungated entries are named too, so the plugin entry is not the only
    // named control in a rail that happened to render.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("names the rail a permission set shortens", () => {
    permissions = { slugs: ["read-content-releases"], isSuperAdmin: false };

    render(
      <TooltipProvider>
        <DualSidebar />
      </TooltipProvider>
    );

    // Media is closed to this reader and must not be reachable by name; the
    // control for it is absent, not merely unnamed.
    expect(screen.queryByRole("link", { name: "Media Library" })).toBeNull();
    // The sections this reader CAN reach are named, which is also the control
    // that keeps the absence above from being an empty rail.
    expect(screen.getByRole("link", { name: "Releases" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
