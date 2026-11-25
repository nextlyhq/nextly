/**
 * The Content navigation lists a collection or Single removed from code,
 * marked as removed, with the notice's next step as the link's description;
 * every other entity is listed as before, unmarked.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

const lists = vi.hoisted(() => ({
  collections: [
    { id: "c1", name: "posts", label: "Posts" },
    {
      id: "c2",
      name: "pages",
      label: "Pages",
      removedFromCode: true,
      removedFromCodeState: { state: "not-dropped" },
    },
  ] as Array<Record<string, unknown>>,
  singles: [
    { id: "s1", slug: "settings", label: "Settings" },
    {
      id: "s2",
      slug: "banner",
      label: "Banner",
      removedFromCode: true,
      removedFromCodeState: {
        state: "drop-pending",
        migration: "20261027_drop_banner.sql",
      },
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarCollectionList: () => ({
    items: lists.collections,
    data: { items: lists.collections },
    isLoading: false,
    isComplete: true,
    error: null,
    isPinned: () => false,
    togglePin: () => {},
  }),
  useSidebarSingleList: () => ({
    items: lists.singles,
    isLoading: false,
    isComplete: true,
    isPinned: () => false,
    togglePin: () => {},
  }),
}));
vi.mock("@admin/hooks/queries/useSingles", () => ({
  useSingles: () => ({ data: { items: [] } }),
  useEverySingle: () => ({ data: [] }),
}));
// What the admin's "open this document" rule reads for each Single's link:
// with no plugin's views published, every Single opens as its form.
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<object>()),
  useEveryNavCollection: () => ({ data: [] }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en" }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    capabilities: {
      collections: Object.fromEntries(
        lists.collections.map(c => [c.name, { canRead: true }])
      ),
      singles: Object.fromEntries(
        lists.singles.map(s => [s.slug, { canRead: true }])
      ),
    },
    canAccessCollection: () => true,
  }),
}));
vi.mock("@admin/components/ui/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@admin/components/layout/sidebar", () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SidebarMenuAction: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  useSidebar: () => ({ state: "expanded", isMobile: false }),
}));

import { DynamicCollectionNav } from "../DynamicCollectionNav";
import { DynamicSingleNav } from "../DynamicSingleNav";

describe("the Content navigation's removed-from-code mark", () => {
  it("marks the removed collection and names its step, and leaves the others unmarked", () => {
    render(
      <TooltipProvider>
        <ul>
          <DynamicCollectionNav isActive={() => false} />
        </ul>
      </TooltipProvider>
    );
    const removed = screen.getByRole("link", { name: /Pages/ });
    expect(removed).toHaveAccessibleDescription(
      /Removed from code\..*“pages”.*nextly migrate:create, then nextly migrate/
    );
    expect(removed).toHaveTextContent("Removed");

    const kept = screen.getByRole("link", { name: /Posts/ });
    expect(kept).not.toHaveTextContent("Removed");
    expect(kept).toHaveAccessibleDescription("");
  });

  it("marks the removed Single and names the migration that retires it", () => {
    render(
      <TooltipProvider>
        <ul>
          <DynamicSingleNav isActive={() => false} />
        </ul>
      </TooltipProvider>
    );
    const removed = screen.getByRole("link", { name: /Banner/ });
    expect(removed).toHaveAccessibleDescription(
      /Removed from code\..*nextly migrate to apply 20261027_drop_banner\.sql/
    );
    expect(removed).toHaveTextContent("Removed");
    expect(
      screen.getByRole("link", { name: /Settings/ })
    ).not.toHaveTextContent("Removed");
  });
});

describe("the Content panel's Removed fold", () => {
  it("keeps removed collections out of the list, behind a fold that starts closed", async () => {
    const { ContentCollections } = await import(
      "@admin/components/layout/sidebar/ContentCollections"
    );
    const { useContentFolds } = await import(
      "@admin/components/layout/sidebar/lib/content-folds"
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    function Panel() {
      const folds = useContentFolds();
      return (
        <ContentCollections
          matched={lists.collections as never}
          pluginMatches={0}
          loading={false}
          search=""
          isActive={() => false}
          folds={folds}
        />
      );
    }
    render(
      <TooltipProvider>
        <Panel />
      </TooltipProvider>
    );

    // The everyday list holds only what is in the code.
    expect(screen.getByRole("link", { name: /Posts/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pages/ })).toBeNull();
    // What was removed is one press away, counted, for whoever may read it.
    const fold = screen.getByRole("button", { name: "Removed, 1" });
    expect(fold).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Pages/ })).toHaveTextContent(
      "Removed"
    );
  });

  it("draws no fold where nothing was removed", async () => {
    const { ContentCollections } = await import(
      "@admin/components/layout/sidebar/ContentCollections"
    );
    const kept = lists.collections.filter(c => c.removedFromCode !== true);
    render(
      <TooltipProvider>
        <ContentCollections
          matched={kept as never}
          pluginMatches={0}
          loading={false}
          search=""
          isActive={() => false}
          folds={{ isFolded: () => false, toggle: () => {} }}
        />
      </TooltipProvider>
    );

    expect(screen.queryByRole("button", { name: /^Removed/ })).toBeNull();
  });
});
