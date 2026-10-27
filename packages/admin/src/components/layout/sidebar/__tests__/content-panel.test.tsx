/**
 * The Content panel switches between Collections and Singles with links in a
 * labelled nav, under one search. These pin the behaviours a person relies on:
 * which part is current, that the parts are links and not tabs, the match dot,
 * the empty-part offer, and that one kind alone shows without a control.
 *
 * The lists are the real ones, fed from mocked data, so a list that stopped
 * applying the search the panel counts with would show items the dot and the
 * empty offer say aren't there, and fail here.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FixtureCollection = { id: string; name: string; label: string };
type FixtureSingle = { id: string; slug: string; label: string };

const lists = vi.hoisted(() => ({
  collections: [] as FixtureCollection[],
  singles: [] as FixtureSingle[],
  singlesComplete: true,
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
    isComplete: lists.singlesComplete,
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
vi.mock("../index", () => ({
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

import { ContentPanel } from "../ContentPanel";

function renderPanel(
  props: Partial<React.ComponentProps<typeof ContentPanel>> = {}
) {
  return render(
    <TooltipProvider>
      <ContentPanel
        part="collections"
        search=""
        onSearchChange={vi.fn()}
        hasCollections
        hasSingles
        isActive={() => false}
        {...props}
      />
    </TooltipProvider>
  );
}

beforeEach(() => {
  lists.collections = [
    { id: "c1", name: "posts", label: "Posts" },
    { id: "c2", name: "authors", label: "Authors" },
  ];
  lists.singles = [
    { id: "s1", slug: "homepage", label: "Homepage" },
    { id: "s2", slug: "footer", label: "Footer" },
  ];
  lists.singlesComplete = true;
});

describe("ContentPanel", () => {
  it("shows the parts as links in a labelled nav, the current one marked", () => {
    renderPanel({ part: "singles" });

    const nav = screen.getByRole("navigation", { name: "Content type" });
    const collections = within(nav).getByRole("link", { name: "Collections" });
    const singles = within(nav).getByRole("link", { name: "Singles" });
    expect(collections).toHaveAttribute("href", "/admin/collections");
    expect(singles).toHaveAttribute("href", "/admin/singles");
    expect(singles).toHaveAttribute("aria-current", "page");
    expect(collections).not.toHaveAttribute("aria-current");
    expect(within(nav).queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Homepage/ })).toBeInTheDocument();
  });

  it("marks the other part when it has matches for the search", () => {
    renderPanel({ part: "collections", search: "foot" });

    expect(
      screen.getByRole("link", { name: "Singles, has matches" })
    ).toBeInTheDocument();
  });

  it("doesn't mark the other part when it has none", () => {
    renderPanel({ part: "collections", search: "post" });

    expect(screen.getByRole("link", { name: "Singles" })).toBeInTheDocument();
  });

  it("lists only the current part's matches, as its count says", () => {
    renderPanel({ part: "collections", search: "post" });

    expect(screen.getByRole("link", { name: /Posts/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Authors/ })
    ).not.toBeInTheDocument();
  });

  it("lists the other part's matches once switched to it", () => {
    renderPanel({ part: "singles", search: "foot" });

    expect(screen.getByRole("link", { name: /Footer/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Homepage/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Collections" })
    ).toBeInTheDocument();
  });

  it("offers the other part's matches when the current part has none", () => {
    renderPanel({ part: "collections", search: "foot" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "No collections match “foot”."
    );
    expect(
      screen.getByRole("link", { name: "See matches in Singles" })
    ).toHaveAttribute("href", "/admin/singles");
  });

  it("shows one kind's list alone, with no control, when the other has none", () => {
    renderPanel({ part: "collections", hasCollections: false });

    expect(
      screen.queryByRole("navigation", { name: "Content type" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Homepage/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search Singles")).toBeInTheDocument();
  });

  it("doesn't say nothing matched while Singles are still arriving", () => {
    lists.singlesComplete = false;
    renderPanel({ part: "singles", search: "pricing" });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // POPULATION CONTROL: once every page is in, it does say so.
    lists.singlesComplete = true;
    renderPanel({ part: "singles", search: "pricing" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No Singles match “pricing”."
    );
  });
});
