/**
 * The Content panel switches between Collections and Singles with links in a
 * labelled nav, under one search. These pin the behaviours a person relies on:
 * which part is current, that the parts are links and not tabs, the match dot,
 * the empty-part offer, and that one kind alone shows without a control.
 */
import { render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lists = vi.hoisted(() => ({
  collections: [] as Array<{ name: string; label: string }>,
  singles: [] as Array<{ slug: string; label: string }>,
}));

vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarCollectionList: () => ({
    items: lists.collections,
    isLoading: false,
  }),
  useSidebarSingleList: () => ({ items: lists.singles, isLoading: false }),
}));
vi.mock("@admin/components/features/dashboard/DynamicCollectionNav", () => ({
  DynamicCollectionNav: ({ search }: { search: string }) => (
    <li>collection list for “{search}”</li>
  ),
}));
vi.mock("@admin/components/features/dashboard/DynamicSingleNav", () => ({
  DynamicSingleNav: ({ search }: { search: string }) => (
    <li>single list for “{search}”</li>
  ),
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
}));

import { ContentPanel } from "../ContentPanel";

function renderPanel(
  props: Partial<React.ComponentProps<typeof ContentPanel>> = {}
) {
  return render(
    <ContentPanel
      part="collections"
      search=""
      onSearchChange={vi.fn()}
      hasCollections
      hasSingles
      isActive={() => false}
      {...props}
    />
  );
}

beforeEach(() => {
  lists.collections = [
    { name: "posts", label: "Posts" },
    { name: "authors", label: "Authors" },
  ];
  lists.singles = [
    { slug: "homepage", label: "Homepage" },
    { slug: "footer", label: "Footer" },
  ];
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
    expect(screen.getByText("single list for “”")).toBeInTheDocument();
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
    expect(screen.getByText("single list for “”")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search Singles")).toBeInTheDocument();
  });
});
