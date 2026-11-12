/**
 * The Content overview: two tables at /admin/content, one at
 * /admin/collections and /admin/singles; a reader of one kind alone sent to
 * that kind's address and never shown an empty table of the other; and, for a
 * reader with neither, the empty state on every address, offering to build a
 * collection only to a reader who may.
 *
 * The lists go through the real filter and sort the Content panel uses, so a
 * hidden collection, a collection the reader may not read and the group order
 * are the panel's own; the rows' figures come from the server's one answer,
 * mocked at the request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { replaceTo } from "@admin/lib/navigation";
import type { AdminBranding } from "@admin/types/branding";

type Fixture = Record<string, unknown> & { name?: string; slug?: string };

const state = vi.hoisted(() => ({
  collections: [] as Fixture[],
  singles: [] as Fixture[],
  loading: false,
  content: { isLoading: false, hasAnswer: true, error: null as Error | null },
  /** Per slug: what the reader may do. */
  caps: {} as Record<
    string,
    { canRead: boolean; canCreate?: boolean; canUpdate?: boolean }
  >,
  permissions: new Set<string>(),
  branding: {} as AdminBranding,
  /** Per collection: entries, drafts, newest edit. */
  stats: {} as Record<
    string,
    { total: number; drafts: number; newest?: string }
  >,
  /** Per Single: its newest event, if any. */
  events: {} as Record<
    string,
    { actorName: string; occurredAt: string } | undefined
  >,
}));

vi.mock("@admin/hooks/useSidebarContentLists", async () => {
  const landing = await import("@admin/lib/sidebar-landing");
  const capabilities = () => ({
    collections: Object.fromEntries(
      Object.entries(state.caps).map(([slug, c]) => [
        slug,
        { canCreate: false, canUpdate: false, ...c },
      ])
    ),
  });
  return {
    useSidebarCollectionList: () => ({
      items: landing.getSidebarCollectionsForLanding(
        state.collections as never,
        {
          branding: state.branding,
          capabilities: capabilities() as never,
          pinnedCollections: new Set(),
        }
      ),
      isLoading: state.loading,
      error: null,
    }),
    useSidebarSingleList: () => ({
      items: landing.getSidebarSinglesForLanding(state.singles as never, {
        capabilities: capabilities() as never,
        pinnedSingles: new Set(),
      }),
      isLoading: state.loading,
    }),
  };
});
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    capabilities: {
      collections: Object.fromEntries(
        Object.entries(state.caps).map(([slug, c]) => [
          slug,
          { canCreate: false, canUpdate: false, ...c },
        ])
      ),
    },
    content: state.content,
    retry: vi.fn(),
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => state.branding,
}));
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  navigateTo: vi.fn(),
  replaceTo: vi.fn(),
}));
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { get } }));

/**
 * What the server's one answer holds for the fixture: a row per collection
 * and Single, as `GET /dashboard/content` builds them.
 */
function serverRows() {
  return [
    ...state.collections.map(collection => {
      const slug = String(collection.name);
      const stats = state.stats[slug] ?? { total: 0, drafts: 0 };
      return {
        kind: "collection",
        slug,
        label: collection.label,
        count: stats.total,
        draft: collection.status === true ? stats.drafts : null,
        canCreate: false,
        ...(stats.newest ? { updatedAt: stats.newest } : {}),
      };
    }),
    ...state.singles.map(single => {
      const slug = String(single.slug);
      const event = state.events[slug];
      return {
        kind: "single",
        slug,
        label: single.label,
        canUpdate: false,
        ...(event
          ? {
              updatedAt: event.occurredAt,
              userId: `id-${event.actorName}`,
              userName: event.actorName,
              actorType: "user",
            }
          : {}),
      };
    }),
  ];
}

import { ContentOverview } from "../ContentOverview";

function draw(scope: React.ComponentProps<typeof ContentOverview>["scope"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ContentOverview scope={scope} />
    </QueryClientProvider>
  );
}

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString();

/** The table of that name: each table also draws its rows as cards. */
function table(name: string) {
  return screen.getByRole("table", { name });
}

/** The row of a table that a name's link is in. */
function rowOf(tableName: string, name: string): HTMLElement {
  const row = within(table(tableName))
    .getByRole("link", { name })
    .closest("tr");
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

/** The first cell of each body row of a table: its names, in order. */
function namesIn(name: string): string[] {
  return within(table(name))
    .getAllByRole("row")
    .slice(1)
    .map(row => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

function readsBoth() {
  state.collections = [
    { id: "c1", name: "posts", label: "Posts", status: true },
    { id: "c2", name: "authors", label: "Authors" },
    {
      id: "c3",
      name: "secret",
      label: "Secret",
      admin: { hidden: true },
    },
  ];
  state.singles = [
    { id: "s1", slug: "homepage", label: "Homepage" },
    { id: "s2", slug: "footer", label: "Footer", admin: { icon: "Archive" } },
  ];
  state.caps = {
    posts: { canRead: true, canCreate: true },
    authors: { canRead: true, canCreate: false },
    secret: { canRead: true, canCreate: true },
    homepage: { canRead: true, canUpdate: true },
    footer: { canRead: true, canUpdate: false },
  };
}

beforeEach(() => {
  vi.mocked(replaceTo).mockClear();
  get.mockReset();
  get.mockImplementation(async () => ({ rows: serverRows() }));
  state.loading = false;
  state.content = { isLoading: false, hasAnswer: true, error: null };
  state.permissions = new Set();
  state.branding = {};
  state.stats = {
    posts: { total: 12, drafts: 2, newest: RECENT },
    authors: { total: 0, drafts: 0 },
  };
  state.events = {
    homepage: { actorName: "Ayesha", occurredAt: RECENT },
    footer: undefined,
  };
  readsBoth();
});

describe("the Content overview", () => {
  it("shows both tables, each row with its figures and its action", async () => {
    draw("all");

    expect(screen.getByRole("heading", { level: 1, name: "Content" }));
    expect(
      screen.getByText(
        "2 collections · 2 Singles. Everything editors write lives here."
      )
    ).toBeInTheDocument();
    // A hidden collection is left out, as the panel leaves it out.
    expect(namesIn("Collections")).toEqual(["Authors", "Posts"]);
    expect(namesIn("Singles")).toEqual(["Footer", "Homepage"]);

    const posts = rowOf("Collections", "Posts");
    expect(within(posts).getByRole("link", { name: "Posts" })).toHaveAttribute(
      "href",
      "/admin/collections/posts"
    );
    // Entries, and its drafts linked to the list's Draft filter.
    expect(await within(posts).findByText("12")).toBeInTheDocument();
    expect(
      within(posts).getByRole("link", { name: "2 drafts in Posts" })
    ).toHaveAttribute("href", "/admin/collections/posts?status=draft");
    expect(within(posts).getByText("5m ago")).toBeInTheDocument();
    expect(
      within(posts).getByRole("link", { name: "New entry in Posts" })
    ).toHaveAttribute("href", "/admin/collections/posts/create");

    const authors = rowOf("Collections", "Authors");
    // No Draft / Published lifecycle: no drafts to count. Never edited.
    expect(await within(authors).findByText("No drafts")).toBeInTheDocument();
    expect(within(authors).getByText("Never edited")).toBeInTheDocument();
    // The reader may not create there: no New.
    expect(
      within(authors).queryByRole("link", { name: /New entry/ })
    ).toBeNull();

    const homepage = rowOf("Singles", "Homepage");
    expect(
      within(homepage).getByRole("link", { name: "Homepage" })
    ).toHaveAttribute("href", "/admin/singles/homepage");
    expect(await within(homepage).findByText("Ayesha")).toBeInTheDocument();
    expect(within(homepage).getByText("5m ago")).toBeInTheDocument();
    expect(
      within(homepage).getByRole("link", { name: "Edit Homepage" })
    ).toBeInTheDocument();
    const footer = rowOf("Singles", "Footer");
    expect(await within(footer).findByText("Never edited")).toBeInTheDocument();
    // A reader who may only read it gets View, to the same page.
    expect(
      within(footer).getByRole("link", { name: "View Footer" })
    ).toHaveAttribute("href", "/admin/singles/footer");
    expect(replaceTo).not.toHaveBeenCalled();
  });

  it("reads every row's figures in one request, however many collections there are", async () => {
    state.collections = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      name: `c${i}`,
      label: `Collection ${String(i).padStart(2, "0")}`,
      status: i % 2 === 0,
    }));
    state.caps = Object.fromEntries([
      ...state.collections.map(c => [String(c.name), { canRead: true }]),
      ["homepage", { canRead: true }],
      ["footer", { canRead: true }],
    ]);
    state.stats = Object.fromEntries(
      state.collections.map((c, i) => [
        String(c.name),
        { total: 100 + i, drafts: i, newest: RECENT },
      ])
    );
    draw("all");

    const last = rowOf("Collections", "Collection 29");
    expect(await within(last).findByText("129")).toBeInTheDocument();
    expect(
      within(table("Singles")).getAllByText("Ayesha").length
    ).toBeGreaterThan(0);
    // 🔴 Thirty collections and two Singles, every cell drawn, from ONE
    // request: a page asking per row would make thirty-two or more.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/dashboard/content");
  });

  it("draws each kind's default icon, and a set icon where one is set", () => {
    draw("all");

    const iconIn = (tableName: string, link: string) =>
      within(table(tableName))
        .getByRole("link", { name: link })
        .querySelector("svg");
    expect(iconIn("Collections", "Posts")).toHaveClass(
      "lucide-list",
      "text-muted-foreground"
    );
    expect(iconIn("Singles", "Homepage")).toHaveClass("lucide-panels-top-left");
    expect(iconIn("Singles", "Footer")).toHaveClass("lucide-archive");
  });

  it("lists each sidebar group under its heading, the groups first, then Other", () => {
    state.collections = [
      { id: "c1", name: "posts", label: "Posts", admin: { order: 1 } },
      {
        id: "c2",
        name: "products",
        label: "Products",
        admin: { sidebarGroup: "shop", order: 20 },
      },
      {
        id: "c3",
        name: "case-studies",
        label: "Case Studies",
        admin: { sidebarGroup: "marketing", order: 10 },
      },
    ];
    state.caps = {
      posts: { canRead: true },
      products: { canRead: true },
      "case-studies": { canRead: true },
      homepage: { canRead: true },
    };
    state.branding = { customGroups: [{ slug: "shop", name: "Online shop" }] };
    draw("collections");

    // Each group's heading, in order: the groups as their first collection
    // appears, then the ungrouped under Other.
    const headings = ["Marketing1", "Online shop1", "Other1"].map(name =>
      screen.getByRole("heading", { level: 3, name })
    );
    for (const [earlier, later] of [
      [headings[0]!, headings[1]!],
      [headings[1]!, headings[2]!],
    ] as const) {
      expect(
        earlier.compareDocumentPosition(later) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(namesIn("Collections: Marketing")).toEqual(["Case Studies"]);
    expect(namesIn("Collections: Online shop")).toEqual(["Products"]);
    expect(namesIn("Collections: Other")).toEqual(["Posts"]);
  });

  it("searches both tables by name", async () => {
    const user = userEvent.setup();
    draw("all");

    await user.type(
      screen.getByRole("searchbox", { name: "Search content" }),
      "ho"
    );

    expect(namesIn("Collections")).toEqual(["Authors"]);
    expect(namesIn("Singles")).toEqual(["Homepage"]);
  });

  it("shows only the collections table at /admin/collections, and stays", () => {
    draw("collections");

    expect(
      screen.getByRole("heading", { level: 1, name: "Collections" })
    ).toBeInTheDocument();
    expect(namesIn("Collections")).toEqual(["Authors", "Posts"]);
    expect(screen.queryByRole("table", { name: "Singles" })).toBeNull();
    // Content › Collections.
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(trail).getByRole("link", { name: "Content" })
    ).toHaveAttribute("href", "/admin/content");
    expect(within(trail).getByText("Collections")).toBeInTheDocument();
    expect(replaceTo).not.toHaveBeenCalled();
  });

  it("shows only the Singles table at /admin/singles, and stays", () => {
    draw("singles");

    expect(namesIn("Singles")).toEqual(["Footer", "Homepage"]);
    expect(screen.queryByRole("table", { name: "Collections" })).toBeNull();
    expect(replaceTo).not.toHaveBeenCalled();
  });
});

describe("a reader of one kind alone", () => {
  it("who reads only Singles sees no collections table, and is sent from /admin/collections to /admin/singles", () => {
    state.caps = {
      posts: { canRead: false },
      authors: { canRead: false },
      homepage: { canRead: true },
      footer: { canRead: true },
    };
    const all = draw("all");
    expect(screen.queryByRole("table", { name: "Collections" })).toBeNull();
    expect(namesIn("Singles")).toEqual(["Footer", "Homepage"]);
    expect(screen.getByText("2 Singles. Everything editors write lives here."));
    all.unmount();

    const collections = draw("collections");
    expect(replaceTo).toHaveBeenCalledWith("/admin/singles");
    expect(screen.queryByRole("table")).toBeNull();
    collections.unmount();

    vi.mocked(replaceTo).mockClear();
    draw("singles");
    expect(namesIn("Singles")).toEqual(["Footer", "Homepage"]);
    expect(replaceTo).not.toHaveBeenCalled();
  });

  it("who reads only collections sees no Singles table, and is sent from /admin/singles to /admin/collections", () => {
    state.caps = {
      posts: { canRead: true },
      authors: { canRead: true },
      homepage: { canRead: false },
      footer: { canRead: false },
    };
    const all = draw("all");
    expect(screen.queryByRole("table", { name: "Singles" })).toBeNull();
    expect(namesIn("Collections")).toEqual(["Authors", "Posts"]);
    all.unmount();

    draw("singles");
    expect(replaceTo).toHaveBeenCalledWith("/admin/collections");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("a reader with no content to open", () => {
  beforeEach(() => {
    state.caps = {};
  });

  it("is redirected nowhere, and each address says there is nothing to open", () => {
    for (const scope of ["all", "collections", "singles"] as const) {
      const view = draw(scope);
      expect(
        screen.getByRole("heading", { name: "No content you can open" })
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
      view.unmount();
    }
    expect(replaceTo).not.toHaveBeenCalled();
  });

  it("is offered to build a collection only where they may", () => {
    const without = draw("all");
    expect(
      screen.queryByRole("link", { name: "Create a collection" })
    ).toBeNull();
    without.unmount();

    state.permissions = new Set([
      "create-settings",
      "update-settings",
      "delete-settings",
    ]);
    const builder = draw("all");
    expect(
      screen.getByRole("link", { name: "Create a collection" })
    ).toHaveAttribute("href", "/admin/builder/collections/new");
    builder.unmount();

    // Not where the Schema Builder is turned off.
    state.branding = { showBuilder: false };
    draw("all");
    expect(
      screen.queryByRole("link", { name: "Create a collection" })
    ).toBeNull();
  });

  it("is told nothing, and sent nowhere, before the server answers what they may do", () => {
    state.content = { isLoading: true, hasAnswer: false, error: null };
    const pending = draw("collections");
    expect(screen.queryByText("No content you can open")).toBeNull();
    expect(replaceTo).not.toHaveBeenCalled();
    pending.unmount();

    // A failed answer is said as a failure, not as an empty install, and
    // sends nowhere, even where a list left over from before holds a Single.
    state.caps = { homepage: { canRead: true } };
    state.content = {
      isLoading: false,
      hasAnswer: false,
      error: new Error("offline"),
    };
    draw("collections");
    expect(screen.getByText("Couldn't check your access")).toBeInTheDocument();
    expect(screen.queryByText("No content you can open")).toBeNull();
    expect(replaceTo).not.toHaveBeenCalled();
  });
});
