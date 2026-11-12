/**
 * The Content panel is one list: collections under a Collections heading,
 * then Singles under a Singles heading, each with its count, under one
 * search. These pin what a person relies on: the order and the counts, the
 * `sidebarGroup` sub-headings, the search across both headings and its empty
 * line, folds remembered for the person, the icons, and that a kind the
 * reader may not read has no heading.
 *
 * The lists are the real ones, fed from mocked data through the real filter
 * and sort, so a list that stopped applying the search the heading counts
 * with, or the group order the panel draws, fails here.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetPerson,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";
import type { AdminBranding } from "@admin/types/branding";

type FixtureCollection = {
  id: string;
  name: string;
  label: string;
  admin?: { sidebarGroup?: string; icon?: string; order?: number };
};
type FixtureSingle = {
  id: string;
  slug: string;
  label: string;
  admin?: { icon?: string };
};

const lists = vi.hoisted(() => ({
  collections: [] as FixtureCollection[],
  singles: [] as FixtureSingle[],
  singlesComplete: true,
  branding: {} as AdminBranding,
}));

vi.mock("@admin/hooks/useSidebarContentLists", async () => {
  const landing = await import("@admin/lib/sidebar-landing");
  const { buildCapabilities } = await vi.importActual<
    typeof import("@admin/hooks/useCurrentUserPermissions")
  >("@admin/hooks/useCurrentUserPermissions");
  // Every kind readable: which kinds show is the panel's `has*` props.
  const capabilities = buildCapabilities([], true, {
    isSuperAdmin: true,
    validUntil: null,
    entities: {},
  });
  return {
    useSidebarCollectionList: () => {
      const items = landing.getSidebarCollectionsForLanding(
        lists.collections as never,
        {
          branding: lists.branding,
          capabilities,
          pinnedCollections: new Set(),
        }
      );
      return {
        items,
        data: { items },
        isLoading: false,
        isComplete: true,
        error: null,
        isPinned: () => false,
        togglePin: () => {},
      };
    },
    useSidebarSingleList: () => ({
      items: landing.getSidebarSinglesForLanding(lists.singles as never, {
        capabilities,
        pinnedSingles: new Set(),
      }),
      isLoading: false,
      isComplete: lists.singlesComplete,
      isPinned: () => false,
      togglePin: () => {},
    }),
  };
});
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => lists.branding,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/hooks/useCurrentUserPermissions")
  >("@admin/hooks/useCurrentUserPermissions");
  return {
    ...actual,
    useCurrentUserPermissions: () => ({ hasPermission: () => true }),
  };
});
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

/** The panel with its search held as the sidebar holds it. */
function Panel(
  props: Partial<React.ComponentProps<typeof ContentPanel>>
): React.JSX.Element {
  const [search, setSearch] = React.useState(props.search ?? "");
  return (
    <TooltipProvider>
      <ContentPanel
        hasCollections
        hasSingles
        isActive={() => false}
        {...props}
        search={search}
        onSearchChange={setSearch}
      />
    </TooltipProvider>
  );
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ContentPanel>> = {}
) {
  return render(<Panel {...props} />);
}

/** The panel's navigation, where its headings and links are. */
function contentNav() {
  return screen.getByRole("navigation", { name: "Content" });
}

/** A heading's button, found by its label (its name also holds its count). */
function heading(label: string) {
  return within(contentNav()).getByRole("button", {
    name: new RegExp(`^${label}, \\d+$`),
  });
}

/** The panel's headings, sub-headings and links, in document order. */
function outline(): string[] {
  return Array.from(
    contentNav().querySelectorAll<HTMLElement>("button, a")
  ).flatMap(element =>
    element.closest("[hidden]") ? [] : [element.textContent ?? ""]
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDeviceMemoryForTests();
  lists.collections = [
    { id: "c1", name: "posts", label: "Posts" },
    { id: "c2", name: "authors", label: "Authors" },
  ];
  lists.singles = [
    { id: "s1", slug: "homepage", label: "Homepage" },
    { id: "s2", slug: "footer", label: "Footer" },
  ];
  lists.singlesComplete = true;
  lists.branding = {};
});

afterEach(cleanup);

describe("ContentPanel", () => {
  it("lists Collections, then Singles, each heading with its count, and no segmented control", () => {
    renderPanel();

    expect(outline()).toEqual([
      "Collections2",
      "Authors",
      "Posts",
      "Singles2",
      "Footer",
      "Homepage",
    ]);
    expect(heading("Collections")).toHaveAttribute("aria-expanded", "true");
    expect(heading("Singles")).toHaveAttribute("aria-expanded", "true");
    // The links are the panel's navigation; no switch picks a kind.
    expect(
      within(contentNav()).getByRole("link", { name: "Homepage" })
    ).toHaveAttribute("href", "/admin/singles/homepage");
    expect(
      screen.queryByRole("navigation", { name: "Content type" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("lists each sidebarGroup under its own sub-heading, groups as they first appear, then the ungrouped", () => {
    lists.collections = [
      // Out of order on purpose: the panel's order comes from admin.order,
      // then the name, not from the order the server sent.
      {
        id: "c1",
        name: "newsletters",
        label: "Newsletters",
        admin: { sidebarGroup: "marketing", order: 30 },
      },
      {
        id: "c2",
        name: "products",
        label: "Products",
        admin: { sidebarGroup: "shop", order: 20 },
      },
      { id: "c3", name: "posts", label: "Posts", admin: { order: 40 } },
      {
        id: "c4",
        name: "case-studies",
        label: "Case Studies",
        admin: { sidebarGroup: "marketing", order: 10 },
      },
      {
        id: "c5",
        name: "pages",
        label: "Pages",
        admin: { sidebarGroup: "collections", order: 50 },
      },
    ];
    lists.branding = {
      customGroups: [{ slug: "shop", name: "Online shop" }],
    };
    renderPanel();

    expect(outline()).toEqual([
      "Collections5",
      // Marketing's first collection (order 10) comes before Shop's (20).
      "Marketing",
      "Case Studies",
      "Newsletters",
      // A group named in the site's custom groups shows that name.
      "Online shop",
      "Products",
      // The ungrouped last; naming the built-in section is naming no group.
      "Posts",
      "Pages",
      "Singles2",
      "Footer",
      "Homepage",
    ]);
    const marketing = within(contentNav()).getByRole("button", {
      name: "Marketing",
    });
    expect(marketing).toHaveAttribute("aria-expanded", "true");
    // A group's collections sit in its own region, under its sub-heading;
    // the ungrouped ones do not.
    const region = document.getElementById(
      marketing.getAttribute("aria-controls") ?? ""
    );
    expect(region).toContainElement(
      screen.getByRole("link", { name: "Case Studies" })
    );
    expect(region).not.toContainElement(
      screen.getByRole("link", { name: "Posts" })
    );
  });

  it("filters both headings with the one search, and counts what each lists", async () => {
    const user = userEvent.setup();
    renderPanel();

    // "ho" is in Authors and in Homepage, and in neither Posts nor Footer.
    await user.type(
      screen.getByRole("textbox", { name: "Search content" }),
      "ho"
    );

    expect(outline()).toEqual([
      "Collections1",
      "Authors",
      "Singles1",
      "Homepage",
    ]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says so in one line when nothing matches under either heading", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(
      screen.getByRole("textbox", { name: "Search content" }),
      "pricing"
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing matches “pricing”."
    );
    expect(outline()).toEqual(["Collections0", "Singles0"]);
  });

  it("doesn't say nothing matched while Singles are still arriving", () => {
    lists.singlesComplete = false;
    const first = renderPanel({ search: "pricing" });

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    // POPULATION CONTROL: once every page is in, it does say so.
    first.unmount();
    lists.singlesComplete = true;
    renderPanel({ search: "pricing" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing matches “pricing”."
    );
  });

  it("folds a heading by click, Enter or Space, and names what it folds", async () => {
    const user = userEvent.setup();
    renderPanel();
    const collections = heading("Collections");
    const region = document.getElementById(
      collections.getAttribute("aria-controls") ?? ""
    );
    expect(region).not.toBeNull();
    expect(region).toContainElement(
      screen.getByRole("link", { name: "Posts" })
    );

    await user.click(collections);
    expect(collections).toHaveAttribute("aria-expanded", "false");
    expect(region).not.toBeVisible();
    expect(screen.queryByRole("link", { name: "Posts" })).toBeNull();
    // The other heading is its own fold.
    expect(screen.getByRole("link", { name: "Homepage" })).toBeVisible();

    collections.focus();
    await user.keyboard("{Enter}");
    expect(collections).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(collections).toHaveAttribute("aria-expanded", "false");
  });

  it("remembers the person's folds across a reload, and forgets them when they sign out", async () => {
    lists.collections.push({
      id: "c3",
      name: "products",
      label: "Products",
      admin: { sidebarGroup: "shop" },
    });
    const user = userEvent.setup();
    const first = renderPanel();
    await user.click(heading("Singles"));
    await user.click(
      within(contentNav()).getByRole("button", { name: "Shop" })
    );
    first.unmount();

    // A reload: the page's memory is gone, the device's preferences stay.
    resetDeviceMemoryForTests();
    const second = renderPanel();
    expect(heading("Singles")).toHaveAttribute("aria-expanded", "false");
    expect(
      within(contentNav()).getByRole("button", { name: "Shop" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(heading("Collections")).toHaveAttribute("aria-expanded", "true");
    expect(outline()).toEqual([
      "Collections3",
      "Shop",
      "Authors",
      "Posts",
      "Singles2",
    ]);
    second.unmount();

    // Signing out forgets them with the person: the next one starts open.
    forgetPerson();
    resetDeviceMemoryForTests();
    renderPanel();
    expect(heading("Singles")).toHaveAttribute("aria-expanded", "true");
  });

  it("draws the kind's default icon where none is set, and a set icon where one is", () => {
    lists.collections = [
      { id: "c1", name: "posts", label: "Posts" },
      {
        id: "c2",
        name: "archive",
        label: "Archive",
        admin: { icon: "Archive" },
      },
    ];
    lists.singles = [
      { id: "s1", slug: "homepage", label: "Homepage" },
      { id: "s2", slug: "alerts", label: "Alerts", admin: { icon: "Bell" } },
    ];
    renderPanel();

    const iconOf = (name: string) =>
      screen.getByRole("link", { name }).querySelector("svg");
    // A list for a collection, a framed page for a Single, both muted, at
    // the 16px the list draws.
    expect(iconOf("Posts")).toHaveClass(
      "lucide-list",
      "h-4",
      "w-4",
      "text-muted-foreground"
    );
    expect(iconOf("Homepage")).toHaveClass(
      "lucide-panels-top-left",
      "h-4",
      "w-4",
      "text-muted-foreground"
    );
    expect(iconOf("Posts")).toHaveAttribute("aria-hidden", "true");
    // A set icon is kept.
    expect(iconOf("Archive")).toHaveClass("lucide-archive");
    expect(iconOf("Archive")).not.toHaveClass("lucide-list");
    expect(iconOf("Alerts")).toHaveClass("lucide-bell");
    expect(iconOf("Alerts")).not.toHaveClass("lucide-panels-top-left");
  });

  it("shows a reader of Singles alone no Collections heading", () => {
    renderPanel({ hasCollections: false });

    expect(outline()).toEqual(["Singles2", "Footer", "Homepage"]);
  });

  it("shows a reader of collections alone no Singles heading", () => {
    renderPanel({ hasSingles: false });

    expect(outline()).toEqual(["Collections2", "Authors", "Posts"]);
  });

  it("drops a heading whose kind turned out to list nothing", () => {
    lists.singles = [];
    renderPanel();

    expect(outline()).toEqual(["Collections2", "Authors", "Posts"]);
  });
});
