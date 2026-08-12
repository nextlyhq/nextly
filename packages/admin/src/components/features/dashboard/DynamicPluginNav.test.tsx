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

describe("DynamicPluginNav collapsed", () => {
  it("offers the guarded destinations to a user who can open them", async () => {
    givePluginWithReadableCollection();

    const { container } = renderNav({ collapsed: true });
    fireEvent.mouseEnter(container.querySelector("li")!);

    expect(
      await screen.findByRole("menuitem", { name: /installed plugins/i })
    ).toBeInTheDocument();
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
