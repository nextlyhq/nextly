/**
 * The plugins panel must offer a route to the overview on every install,
 * including one with nothing installed.
 *
 * This is the case the component previously returned `null` for. It matters
 * most on mobile, where the primary plugins icon only opens this panel rather
 * than navigating, so an empty panel left `/admin/plugins` unreachable from
 * anywhere in the UI.
 */
import { render, screen } from "@testing-library/react";
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
function renderNav() {
  return render(
    <SidebarProvider>
      <DynamicPluginNav isActive={noop} />
    </SidebarProvider>
  );
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
   * The separating case, corrected. An earlier version asserted that a
   * collections error suppressed the link, which encoded a bug as the control:
   * `/admin/plugins` reads `admin-meta`, not collections, so it stays reachable
   * during that failure and only the collection-derived entries are lost.
   *
   * What actually separates "renders the link always" from "renders it for the
   * right users" is the capability, so that is the control.
   */
  it("withholds the link from a collection reader who cannot open the page", () => {
    // The panel must still RENDER for this user — they opened it to reach
    // their plugin's collections — so a plugin collection is present. Without
    // it the component returns early and the assertion below passes on the
    // early return rather than on the link being gated, which is what an
    // earlier version of this test did.
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
    // than about a component that returned null. An earlier version asserted
    // only the absence, and passed on the early return instead of the gate.
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

    // Exactly one: the panel previously grew a second, parallel copy of this
    // link so that the empty case had one, which produced two adjacent links
    // to the same page on every non-empty install.
    expect(
      screen.getAllByRole("link", { name: /installed plugins/i })
    ).toHaveLength(1);
  });
});
