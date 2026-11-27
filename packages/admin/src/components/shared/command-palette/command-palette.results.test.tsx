// @vitest-environment jsdom
/**
 * The palette's results as a reader sees them, read from the menus' own
 * hooks: what an admin is offered, what a role that reads three collections
 * is offered, and where a pick goes.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Kind = {
  name: string;
  label: string;
  labels?: { singular: string; plural: string };
  admin?: Record<string, unknown>;
};

/** What the Content panel lists for this test's reader. */
let listed: Kind[] = [];
let listedSingles: { slug: string; label: string }[] = [];
/** Every collection the navigation reads, for the types one may create. */
let offered: Kind[] = [];
let granted = new Set<string>();
let mayCreate: string[] = [];

/** How far the Content panel's lists have got: all in, unless a test says. */
let listState = {
  collectionsLoading: false,
  collectionsError: null as Error | null,
  singlesComplete: true,
  singlesError: null as Error | null,
};
const retryCollections = vi.fn();
const retrySingles = vi.fn();
vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useEveryListedCollection: () => ({
    items: listed,
    isLoading: listState.collectionsLoading,
    error: listState.collectionsError,
    retry: retryCollections,
  }),
  useSidebarSingleList: () => ({
    items: listedSingles,
    isComplete: listState.singlesComplete,
    error: listState.singlesError,
    retry: retrySingles,
  }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({
    data: offered,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => granted.has(slug),
    canAccessCollection: (slug: string, action: string) =>
      action === "create" && mayCreate.includes(slug),
    capabilities: { canManageSettings: granted.has("update-settings") },
    content: { isLoading: false, error: null, hasAnswer: true },
  }),
}));
vi.mock("@admin/lib/navigation/useDocumentAddress", () => ({
  useDocumentAddress:
    () =>
    (document: { slug: string }): string =>
      `/admin/singles/${document.slug}`,
}));
/** The site's branding answer; `showBuilder` absent while it is unknown. */
let branding: { showBuilder?: boolean } = { showBuilder: true };
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));
const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

import { CommandPalette } from "./index";
import { setPaletteOpen } from "./palette-store";

function Bare({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function openPalette(): void {
  render(<CommandPalette />, { wrapper: Bare });
  act(() => setPaletteOpen(true));
}

/** The rows under one heading, as drawn. */
function rowsUnder(heading: string): string[] {
  const group = [...document.querySelectorAll("[cmdk-group]")].find(
    g => g.querySelector("[cmdk-group-heading]")?.textContent === heading
  );
  if (!(group instanceof HTMLElement)) return [];
  return within(group)
    .queryAllByRole("option")
    .map(option => option.textContent ?? "");
}

const posts: Kind = {
  name: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
};
const faq: Kind = { name: "faq", label: "FAQ" };
const authors: Kind = {
  name: "authors",
  label: "Authors",
  labels: { singular: "Author", plural: "Authors" },
};

beforeEach(() => {
  listState = {
    collectionsLoading: false,
    collectionsError: null,
    singlesComplete: true,
    singlesError: null,
  };
  retryCollections.mockClear();
  retrySingles.mockClear();
  navigateTo.mockClear();
  listedSingles = [{ slug: "homepage", label: "Homepage" }];
  branding = { showBuilder: true };
});
afterEach(() => {
  cleanup();
  act(() => setPaletteOpen(false));
});

describe("the palette for an admin", () => {
  beforeEach(() => {
    listed = [posts, faq, authors];
    // Kept off the admin, and one only a machine creates: never offered.
    offered = [
      posts,
      faq,
      authors,
      { name: "audit", label: "Audit", admin: { hidden: true } },
      {
        name: "submissions",
        label: "Submissions",
        admin: { disableCreate: true },
      },
    ];
    mayCreate = ["posts", "faq", "authors", "audit", "submissions"];
    granted = new Set([
      "read-settings",
      "update-settings",
      "read-users",
      "create-users",
      "read-roles",
      "create-roles",
    ]);
  });

  it("lists collections, Singles, pages and actions, each under its heading", () => {
    openPalette();
    expect(rowsUnder("Collections")).toEqual(["Posts", "FAQ", "Authors"]);
    expect(rowsUnder("Singles")).toEqual(["Homepage"]);
    const pages = rowsUnder("Pages").join("|");
    for (const page of [
      "Dashboard",
      "General",
      "Users",
      "Roles",
      "Account settings",
    ]) {
      expect(pages).toContain(page);
    }
    const actions = rowsUnder("Actions");
    expect(actions).toEqual(
      expect.arrayContaining([
        "New Post",
        "New FAQ",
        "New Author",
        "Create user",
      ])
    );
    expect(actions).not.toContain("New Audit");
    expect(actions).not.toContain("New Submission");
  });

  it("opens a collection's list, a Single and a Settings page where the menus would", () => {
    openPalette();
    fireEvent.click(screen.getByRole("option", { name: "Posts" }));
    expect(navigateTo).toHaveBeenLastCalledWith("/admin/collections/posts");
    act(() => setPaletteOpen(true));
    fireEvent.click(screen.getByRole("option", { name: "Homepage" }));
    expect(navigateTo).toHaveBeenLastCalledWith("/admin/singles/homepage");
    act(() => setPaletteOpen(true));
    fireEvent.click(screen.getByRole("option", { name: /^General/ }));
    expect(navigateTo).toHaveBeenLastCalledWith("/admin/settings");
  });

  it("opens a new entry of a type from its New action", () => {
    openPalette();
    fireEvent.click(screen.getByRole("option", { name: "New Post" }));
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/posts/create");
  });

  it("tells two types of one label apart", () => {
    const article = { singular: "Article", plural: "Articles" };
    listed = offered = [
      { name: "articles", label: "Articles", labels: article },
      { name: "news", label: "News", labels: article },
    ];
    mayCreate = ["articles", "news"];
    openPalette();
    const both = screen.getAllByRole("option", { name: "New Article" });
    expect(both).toHaveLength(2);
    // The list selects by value: one shared value would select both at once.
    expect(both[0]?.getAttribute("data-value")).not.toBe(
      both[1]?.getAttribute("data-value")
    );
    expect(
      screen
        .getAllByRole("option")
        .filter(option => option.getAttribute("aria-selected") === "true")
    ).toHaveLength(1);
  });
});

describe("what the palette says when nothing matches", () => {
  beforeEach(() => {
    listed = [posts];
    offered = [posts];
    mayCreate = [];
    granted = new Set(["read-posts"]);
  });

  function search(text: string): void {
    openPalette();
    fireEvent.change(screen.getByPlaceholderText("Search or jump to…"), {
      target: { value: text },
    });
  }

  it("says nothing matched once every list is in", () => {
    search("zzzz");
    expect(screen.queryAllByText("No results found.")).not.toEqual([]);
  });

  // A Single on a page not read yet may be the one searched for.
  it("says the lists are still arriving rather than that nothing matched", () => {
    listState.singlesComplete = false;
    search("zzzz");
    expect(screen.queryAllByText("No results found.")).toEqual([]);
    expect(
      screen.queryAllByText("Still loading collections and Singles…")
    ).not.toEqual([]);
  });

  it("says a list could not be loaded, and retries both on Retry", () => {
    listState.singlesError = new Error("offline");
    search("zzzz");
    expect(screen.queryAllByText("No results found.")).toEqual([]);
    expect(
      screen.queryAllByText("Some collections or Singles could not be loaded.")
    ).not.toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retrySingles).toHaveBeenCalledTimes(1);
    expect(retryCollections).toHaveBeenCalledTimes(1);
  });
});

describe("the Builders pages in the palette", () => {
  beforeEach(() => {
    listed = [posts];
    offered = [posts];
    mayCreate = [];
    granted = new Set(["read-posts"]);
  });

  const builderRows = () =>
    rowsUnder("Pages").filter(row => /Field Groups/.test(row));

  it("offers them once the site says the builder is on", () => {
    branding = { showBuilder: true };
    openPalette();
    expect(builderRows()).not.toEqual([]);
  });

  // The Builders pages open only on the site's explicit yes; while the answer
  // is in flight or failed, a pick would land on a page that cannot open.
  it("offers none while the site's answer is unknown, or says the builder is off", () => {
    branding = {};
    openPalette();
    expect(builderRows()).toEqual([]);
    cleanup();
    branding = { showBuilder: false };
    openPalette();
    expect(builderRows()).toEqual([]);
  });
});

describe("the palette for a role that reads three collections", () => {
  beforeEach(() => {
    // What this reader may read is the Content panel's list, which the
    // server narrows per reader; the navigation's wider list also holds a
    // collection the panel leaves out for them. A palette that read the wider
    // list, rather than the panel's, would offer Payroll.
    listed = [posts, faq, authors];
    listedSingles = [];
    offered = [posts, faq, authors, { name: "payroll", label: "Payroll" }];
    mayCreate = [];
    granted = new Set(["read-posts", "read-faq", "read-authors"]);
  });

  it("offers only what they may open", () => {
    openPalette();
    expect(rowsUnder("Collections")).toEqual(["Posts", "FAQ", "Authors"]);
    expect(document.body.textContent).not.toContain("Payroll");
    expect(rowsUnder("Singles")).toEqual([]);
    const pages = rowsUnder("Pages").join("|");
    expect(pages).toContain("Dashboard");
    expect(pages).toContain("Account settings");
    for (const page of ["General", "Users", "Roles", "API Keys"]) {
      expect(pages).not.toContain(page);
    }
    const actions = rowsUnder("Actions");
    expect(actions.some(action => action.startsWith("New "))).toBe(false);
    expect(actions).not.toContain("Create user");
    expect(actions).not.toContain("Create role");
  });
});
