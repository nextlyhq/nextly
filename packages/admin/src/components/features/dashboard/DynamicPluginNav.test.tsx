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
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    capabilities: { canViewCollections: true, canManageSettings: true },
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
   * The separating case. Without it, a component that rendered the link
   * unconditionally under every circumstance would satisfy the assertion
   * above, including when the panel should be suppressed entirely.
   */
  it("renders nothing when the collections query errored", () => {
    mockBranding = { plugins: [] } as unknown as AdminBranding;
    mockIsError = true;

    renderNav();

    expect(
      screen.queryByRole("link", { name: /installed plugins/i })
    ).toBeNull();
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
