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
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));
vi.mock("@admin/hooks/usePluginAutoRegistration", () => ({
  usePluginAutoRegistration: () => {},
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
