/**
 * The plugins panel must offer a route to the overview on every install,
 * including one with nothing installed.
 *
 * The empty-install case matters most on mobile, where the primary plugins
 * icon only opens this panel rather than navigating, so a panel with no link
 * leaves `/admin/plugins` unreachable from anywhere in the UI.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding | undefined;
let mockCollections: { items: unknown[] } | undefined = { items: [] };
let mockIsLoading = false;
let mockIsError = false;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));
let mockCanManageSettings = true;
let mockCollectionCaps: Record<string, { canRead: boolean }> = {};
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    capabilities: {
      canViewCollections: true,
      canManageSettings: mockCanManageSettings,
      isSuperAdmin: false,
      // Real `filterCollectionItems` runs here rather than a stub: a
      // pass-through mock would certify that a collection reaches the panel
      // without the permission that actually admits it.
      collections: mockCollectionCaps,
    },
  }),
}));
vi.mock("@admin/hooks/queries", () => ({
  useCollections: () => ({
    data: mockCollections,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: mockIsError ? new Error("boom") : undefined,
  }),
}));
import { DynamicPluginNav } from "@admin/components/features/dashboard/DynamicPluginNav";
import { SidebarProvider } from "@admin/components/layout/sidebar";

const noop = () => false;

// The real provider rather than a mocked `useSidebar`: the component reads
// collapsed state from it, so a stub would let a change to that contract pass
// unnoticed here.
function renderNav({ collapsed = false }: { collapsed?: boolean } = {}) {
  return render(
    <SidebarProvider defaultOpen={!collapsed}>
      <DynamicPluginNav isActive={noop} />
    </SidebarProvider>
  );
}

/** A plugin owning one collection this user is permitted to read. */
function givePluginWithReadableCollection() {
  mockBranding = {
    plugins: [{ name: "@acme/p", collections: ["widgets"] }],
  } as unknown as AdminBranding;
  mockCollectionCaps = { widgets: { canRead: true } };
  mockCollections = {
    items: [
      {
        id: "c1",
        name: "widgets",
        label: "Widgets",
        labels: { plural: "Widgets" },
        admin: { isPlugin: true, group: "Acme" },
      },
    ],
  };
}

afterEach(() => {
  mockBranding = undefined;
  mockCollections = { items: [] };
  mockIsLoading = false;
  mockIsError = false;
  mockCanManageSettings = true;
  mockCollectionCaps = {};
  vi.restoreAllMocks();
});

describe("DynamicPluginNav", () => {
  it("offers the overview link when nothing is installed", () => {
    mockBranding = { plugins: [] } as unknown as AdminBranding;

    renderNav();

    const link = screen.getByRole("link", { name: /installed plugins/i });
    expect(link).toHaveAttribute("href", "/admin/plugins");
  });

  /**
   * The separating case: what distinguishes "renders the link always" from
   * "renders it for users who can open the page" is the capability, not the
   * presence of data. A collections error is not that separator, because
   * `/admin/plugins` reads `admin-meta` and stays reachable through one.
   */
  it("withholds the link from a collection reader who cannot open the page", () => {
    // The panel must still RENDER for this user, since they opened it to reach
    // their plugin's collections, so a plugin collection is present. Without
    // one the component returns early and the assertion below is satisfied by
    // that return rather than by the gate under test.
    mockCanManageSettings = false;
    mockBranding = {
      plugins: [{ name: "@acme/p", collections: ["widgets"] }],
    } as unknown as AdminBranding;
    mockCollectionCaps = { widgets: { canRead: true } };
    mockCollections = {
      items: [
        {
          id: "c1",
          name: "widgets",
          label: "Widgets",
          labels: { plural: "Widgets" },
          admin: { isPlugin: true },
        },
      ],
    };

    const { container } = renderNav();

    // Positive control on the component, not on any particular row: the panel
    // rendered something, so the missing link is a fact about the gate rather
    // than about a component that returned null.
    expect(container).not.toBeEmptyDOMElement();
    expect(
      screen.queryByRole("link", { name: /installed plugins/i })
    ).toBeNull();
  });

  it("keeps the link while the collections query is still loading", () => {
    // The skeleton stands in for the collection entries. The overview reads
    // admin-meta, which has resolved, so replacing the whole panel would make
    // /admin/plugins unreachable for the duration of a slow request.
    mockBranding = { plugins: [] } as unknown as AdminBranding;
    mockIsLoading = true;

    renderNav();

    expect(
      screen.getByRole("link", { name: /installed plugins/i })
    ).toHaveAttribute("href", "/admin/plugins");
  });

  it("withholds it while loading from a user who cannot open it", () => {
    mockBranding = { plugins: [] } as unknown as AdminBranding;
    mockIsLoading = true;
    mockCanManageSettings = false;

    renderNav();

    expect(
      screen.queryByRole("link", { name: /installed plugins/i })
    ).toBeNull();
  });

  it("keeps the link when the collections query errors", () => {
    mockBranding = { plugins: [] } as unknown as AdminBranding;
    mockIsError = true;

    renderNav();

    // The overview reads admin-meta, so a collections failure must not remove
    // the only sidebar route to it — on mobile the primary icon is a button
    // that opens this panel rather than navigating.
    expect(
      screen.getByRole("link", { name: /installed plugins/i })
    ).toHaveAttribute("href", "/admin/plugins");
  });

  it("still offers exactly one overview link when plugins are installed", () => {
    mockBranding = {
      plugins: [{ name: "@acme/p", collections: [] }],
    } as unknown as AdminBranding;

    renderNav();

    // Exactly one. This component owns the overview link; a second copy
    // rendered by the panel around it would put two adjacent links to the same
    // page in front of every non-empty install.
    expect(
      screen.getAllByRole("link", { name: /installed plugins/i })
    ).toHaveLength(1);
  });
});

describe("DynamicPluginNav expanded", () => {
  /**
   * A group is expandable when it retains a collection, and only then.
   *
   * Two plugins can share a display group — every collection without an
   * `admin.group` heading lands under "Other" — and they need not agree about
   * placement. A group-level placement answer has to be one value for both, so
   * it hides the group that still holds a reachable collection: the rail shows
   * a Plugins item whose panel has nothing in it.
   */
  it("expands a shared group that still retains a reachable collection", () => {
    mockCanManageSettings = false;
    mockBranding = {
      plugins: [
        {
          name: "@acme/moves",
          collections: ["gadgets"],
          placement: "settings",
        },
        { name: "@acme/stays", collections: ["widgets"] },
      ],
    } as unknown as AdminBranding;
    mockCollectionCaps = {
      widgets: { canRead: true },
      gadgets: { canRead: true },
    };
    mockCollections = {
      items: [
        // `gadgets` first, so the placed plugin is the one a group-level
        // lookup would find and apply to the whole group.
        {
          id: "c2",
          name: "gadgets",
          labels: { plural: "Gadgets" },
          admin: { isPlugin: true },
        },
        {
          id: "c1",
          name: "widgets",
          labels: { plural: "Widgets" },
          admin: { isPlugin: true },
        },
      ],
    };

    renderNav();

    // The group renders, because `widgets` is still under Plugins.
    expect(screen.getByRole("button", { name: /other/i })).toBeInTheDocument();
  });
});

describe("DynamicPluginNav collapsed", () => {
  it("offers the guarded destinations to a user who can open them", async () => {
    givePluginWithReadableCollection();

    const { container } = renderNav({ collapsed: true });
    fireEvent.mouseEnter(container.querySelector("li")!);

    expect(
      await screen.findByRole("menuitem", { name: /installed plugins/i })
    ).toBeInTheDocument();
  });

  it("omits a placed plugin's collections from the collection reader's menu", async () => {
    // A placed plugin's collections live under Collections, Settings or its own
    // standalone section. Repeating them here would show one collection twice.
    mockCanManageSettings = false;
    mockBranding = {
      plugins: [
        { name: "@acme/here", collections: ["widgets"], placement: "plugins" },
        {
          name: "@acme/elsewhere",
          collections: ["gadgets"],
          placement: "settings",
        },
      ],
    } as unknown as AdminBranding;
    mockCollectionCaps = {
      widgets: { canRead: true },
      gadgets: { canRead: true },
    };
    mockCollections = {
      items: [
        {
          id: "c1",
          name: "widgets",
          labels: { plural: "Widgets" },
          admin: { isPlugin: true, group: "Here" },
        },
        {
          id: "c2",
          name: "gadgets",
          labels: { plural: "Gadgets" },
          admin: { isPlugin: true, group: "Elsewhere" },
        },
      ],
    };

    const { container } = renderNav({ collapsed: true });
    fireEvent.mouseEnter(container.querySelector("li")!);

    // Positive control: the unplaced one IS offered, so the absence below is
    // about placement rather than about a menu that rendered nothing.
    expect(
      await screen.findByRole("menuitem", { name: "Widgets" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Gadgets" })).toBeNull();
  });

  /**
   * The same omission, for a placed collection that declares no `admin.group`.
   *
   * `admin.group` is an optional heading, so these collections are grouped
   * under "Other" and are identifiable only by the plugin that owns them.
   * Placement is read from that owner, which is what keeps the collection out
   * of this menu while it is rendered under Settings.
   */
  it("omits a placed collection that declares no display group", async () => {
    mockCanManageSettings = false;
    mockBranding = {
      plugins: [
        { name: "@acme/here", collections: ["widgets"], placement: "plugins" },
        {
          name: "@acme/elsewhere",
          collections: ["gadgets"],
          placement: "settings",
        },
      ],
    } as unknown as AdminBranding;
    mockCollectionCaps = {
      widgets: { canRead: true },
      gadgets: { canRead: true },
    };
    mockCollections = {
      items: [
        {
          id: "c1",
          name: "widgets",
          labels: { plural: "Widgets" },
          admin: { isPlugin: true, group: "Here" },
        },
        {
          id: "c2",
          name: "gadgets",
          labels: { plural: "Gadgets" },
          // No `group`: owned by a plugin, but carrying no heading.
          admin: { isPlugin: true },
        },
      ],
    };

    const { container } = renderNav({ collapsed: true });
    fireEvent.mouseEnter(container.querySelector("li")!);

    // Positive control: the unplaced collection IS offered, so the absence
    // below is about placement rather than about an empty menu.
    expect(
      await screen.findByRole("menuitem", { name: "Widgets" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Gadgets" })).toBeNull();
  });

  /**
   * Two plugins, both with group-less collections, disagreeing about placement.
   *
   * This is the case a group-level answer cannot get right at all, rather than
   * one it happens to miss. Both collections are grouped under "Other", so a
   * single flag on that group has to be true or false for both — and one of
   * them is placed while the other is not. Only a per-collection rule can list
   * one and omit the other.
   */
  it("separates two group-less collections that disagree about placement", async () => {
    mockCanManageSettings = false;
    mockBranding = {
      plugins: [
        { name: "@acme/stays", collections: ["widgets"] },
        {
          name: "@acme/moves",
          collections: ["gadgets"],
          placement: "settings",
        },
      ],
    } as unknown as AdminBranding;
    mockCollectionCaps = {
      widgets: { canRead: true },
      gadgets: { canRead: true },
    };
    mockCollections = {
      items: [
        {
          id: "c1",
          name: "widgets",
          labels: { plural: "Widgets" },
          admin: { isPlugin: true },
        },
        {
          id: "c2",
          name: "gadgets",
          labels: { plural: "Gadgets" },
          admin: { isPlugin: true },
        },
      ],
    };

    const { container } = renderNav({ collapsed: true });
    fireEvent.mouseEnter(container.querySelector("li")!);

    expect(
      await screen.findByRole("menuitem", { name: "Widgets" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Gadgets" })).toBeNull();
  });

  /**
   * Every destination the collapsed dropdown offers by default is
   * manage-settings guarded, so a collection reader would get a menu whose
   * every item redirects. They are offered their collections instead.
   */
  it("offers a collection reader their collections, not guarded pages", async () => {
    givePluginWithReadableCollection();
    mockCanManageSettings = false;

    const { container } = renderNav({ collapsed: true });
    fireEvent.mouseEnter(container.querySelector("li")!);

    expect(
      await screen.findByRole("menuitem", { name: "Widgets" })
    ).toHaveAttribute("href", "/admin/collections/widgets");
    expect(
      screen.queryByRole("menuitem", { name: /installed plugins/i })
    ).toBeNull();
  });
});
