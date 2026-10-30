/**
 * The dashboard's Content table, drawn from its `system:content` answer: its columns in order, a
 * collection's row and a Single's, the + only where the reader may create, Edit or View on a
 * Single by whether they may update it, Drafts linked to the list's Draft filter, zeros and
 * empty collections muted, the table at the medium and large tiers and narrowed on a narrow
 * medium card, the stacked form at the small tier, the rows a card's body holds filling it, the
 * subtitle counting the collections and Singles, and no footer, since the admin has no page
 * listing the collections.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import {
  CardHeightContext,
  CardTierContext,
} from "@admin/components/features/widgets/frame/tier";

import { ContentTable } from "./ContentTable";

/** One collection's row as `system:content` answers it. */
function collectionRow(
  slug: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: "collection",
    slug,
    label: slug.charAt(0).toUpperCase() + slug.slice(1),
    group: null,
    count: 9,
    draft: 2,
    canCreate: true,
    updatedAt: "2026-10-29T10:00:00.000Z",
    userId: "user-1",
    userName: "Ana",
    actorType: "user",
    identityErasedAt: null,
    ...overrides,
  };
}

/** One Single's row: no counts, no create decision, and one the reader may update. */
const HOME = {
  kind: "single",
  slug: "home",
  label: "Home",
  group: null,
  canUpdate: true,
  updatedAt: "2026-10-29T09:00:00.000Z",
  userId: "user-2",
  userName: "Ben",
  actorType: "user",
  identityErasedAt: null,
};

/** The query a card is asked at its size: the rows it draws, and one more. */
const QUERY = { source: "system:content", op: "list" as const, limit: 11 };

function draw(
  items: Record<string, unknown>[],
  {
    tier = "large",
    total,
    totalByKind,
    h,
  }: {
    tier?: SizeTier;
    total?: number;
    totalByKind?: Record<string, number>;
    h?: number;
  } = {}
) {
  const props: WidgetComponentProps = {
    widgetId: "core/content-table",
    placementId: "core/content-table",
    settings: {},
    isFetching: false,
    query: QUERY,
    slot: {
      ok: true,
      result: {
        op: "list",
        items,
        ...(total === undefined ? {} : { total }),
        ...(totalByKind === undefined ? {} : { totalByKind }),
      },
    },
  };
  return render(
    <CardTierContext.Provider value={tier}>
      <CardHeightContext.Provider value={h}>
        {inFrame(<ContentTable {...props} />, "Content")}
      </CardHeightContext.Provider>
    </CardTierContext.Provider>
  );
}

/** `n` collections' rows, in the order the answer gives them. */
const collectionRows = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    collectionRow(`c${String(i).padStart(2, "0")}`)
  );

/**
 * Every element measured `width` px wide, as a card's body is once drawn; jsdom measures nothing.
 * The card's tier is still the one each case provides, which wins over a measured one.
 */
function bodyWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width, height: 40 })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

const rows = () => screen.getAllByTestId("content-table-row");
const rowOf = (label: string) =>
  rows().find(row => within(row).queryByRole("link", { name: label }))!;

describe("the Content table", () => {
  it("heads its columns in order: Name, Entries, Drafts, Updated, then the action", () => {
    draw([collectionRow("posts")]);
    const headings = within(screen.getByTestId("content-table"))
      .getAllByRole("columnheader")
      .map(heading => heading.textContent);
    // "Name", not "Collection": a Single's row sits under it too.
    expect(headings).toEqual([
      "Name",
      "Entries",
      "Drafts",
      "Updated",
      "Actions",
    ]);
  });

  it("draws a collection's row: its list, its entries, its drafts and a + to a new entry", () => {
    draw([collectionRow("posts")]);
    const row = rowOf("Posts");
    expect(within(row).getByRole("link", { name: "Posts" })).toHaveAttribute(
      "href",
      "/admin/collections/posts"
    );
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("9");
    // The drafts open the list under its own Draft filter, the rule they were counted by.
    expect(
      within(row).getByRole("link", { name: "2 drafts in Posts" })
    ).toHaveAttribute("href", "/admin/collections/posts?status=draft");
    expect(
      within(row).getByRole("link", { name: "New entry in Posts" })
    ).toHaveAttribute("href", "/admin/collections/posts/create");
  });

  it("draws + only on the rows the reader may create in", () => {
    draw([
      collectionRow("posts"),
      collectionRow("tags", { canCreate: false }),
      // A row whose answer says nothing about creating is a refusal, not a guess.
      collectionRow("pages", { canCreate: undefined }),
    ]);
    expect(
      screen
        .getAllByRole("link", { name: /^New entry in / })
        .map(link => link.getAttribute("aria-label"))
    ).toEqual(["New entry in Posts"]);
  });

  it("draws a Single's row with Single in place of the counts and Edit in place of +", () => {
    draw([collectionRow("posts"), HOME]);
    const row = rowOf("Home");
    const cells = within(row).getAllByRole("cell");
    // The label, "Single" across both count columns, Updated, and the action.
    expect(cells).toHaveLength(4);
    expect(cells[1]).toHaveTextContent(/^Single$/);
    expect(cells[1]).toHaveAttribute("colspan", "2");
    // 🔴 Centred across both count columns, not set right where it reads as a Drafts value.
    expect(cells[1]).toHaveClass("text-center");
    expect(cells[1]).not.toHaveClass("text-right");
    expect(
      within(row).getByRole("link", { name: "Edit Home" })
    ).toHaveAttribute("href", "/admin/singles/home");
    expect(
      within(row).queryByRole("link", { name: /^New entry/ })
    ).not.toBeInTheDocument();
  });

  it("shows — for drafts in a collection without the Draft / Published lifecycle", () => {
    draw([collectionRow("tags", { draft: null })]);
    const drafts = within(rowOf("Tags")).getAllByRole("cell")[2]!;
    expect(drafts).toHaveTextContent("—");
    expect(within(drafts).queryByRole("link")).not.toBeInTheDocument();
  });

  it("draws a zero muted and never as a count, and an empty collection's whole row muted", () => {
    draw([
      collectionRow("posts", { draft: 0 }),
      collectionRow("authors", { count: 0, draft: 0 }),
    ]);
    const posts = within(rowOf("Posts")).getAllByRole("cell");
    // A count is drawn at the count's weight; a zero is not.
    expect(posts[1]?.querySelector("[data-zero]")).toBeNull();
    expect(posts[1]?.firstElementChild).toHaveClass("font-medium");
    expect(posts[2]?.querySelector("[data-zero]")).toHaveClass(
      "text-muted-foreground"
    );
    expect(posts[2]?.querySelector("[data-zero]")).not.toHaveClass(
      "font-medium"
    );
    // A zero is not a link to an empty list.
    expect(within(posts[2]!).queryByRole("link")).not.toBeInTheDocument();
    const authors = rowOf("Authors");
    expect(authors).toHaveAttribute("data-empty", "true");
    expect(rowOf("Posts")).not.toHaveAttribute("data-empty");
    expect(within(authors).getByRole("link", { name: "Authors" })).toHaveClass(
      "text-muted-foreground"
    );
  });

  it("shows when each was last updated, with who saved it on hover, and — only where there is no date", () => {
    draw([
      collectionRow("posts"),
      collectionRow("tags", { updatedAt: undefined, userId: undefined }),
      // A date nobody is named for, as a Single saved before the trail holds.
      { ...HOME, updatedAt: "2024-01-05T08:00:00.000Z", userId: undefined },
    ]);
    const time = within(rowOf("Posts")).getByText(/ago|just now|Oct/);
    expect(time).toHaveAttribute("datetime", "2026-10-29T10:00:00.000Z");
    expect(time.getAttribute("title")).toMatch(/^Saved by Ana, /);
    expect(within(rowOf("Tags")).getAllByRole("cell")[3]).toHaveTextContent(
      "—"
    );
    // 🔴 The date stands without a name.
    const home = rowOf("Home").querySelector("time");
    expect(home).toHaveAttribute("datetime", "2024-01-05T08:00:00.000Z");
    expect(home?.getAttribute("title")).not.toMatch(/^Saved by/);
  });

  it("keeps the order the answer gives", () => {
    draw([collectionRow("tags"), HOME, collectionRow("posts")]);
    expect(
      rows().map(row => within(row).getAllByRole("link")[0]?.textContent)
    ).toEqual(["Tags", "Home", "Posts"]);
  });

  // A card six columns wide is medium; twelve columns wide is large.
  it.each([
    ["6", "medium", 5],
    ["12", "large", 10],
  ] as const)(
    "at width %s draws the rows its %s body holds",
    (_width, tier, drawn) => {
      const answered = Array.from({ length: 11 }, (_, i) =>
        collectionRow(`c${String(i).padStart(2, "0")}`)
      );
      draw(answered, { tier, total: 14 });
      expect(rows()).toHaveLength(drawn);
    }
  );

  it("names what the last change was on hover, from the change the answer names", () => {
    draw([
      collectionRow("posts", { userName: "Ben", event: "published" }),
      // An event this build does not know reads as a save, never as nothing.
      collectionRow("tags", { event: "archived" }),
    ]);
    expect(rowOf("Posts").querySelector("time")?.getAttribute("title")).toMatch(
      /^Published by Ben, /
    );
    expect(rowOf("Tags").querySelector("time")?.getAttribute("title")).toMatch(
      /^Saved by Ana, /
    );
  });

  it("offers View, not Edit, on a Single the reader may read and not update, to the same page", () => {
    draw([
      HOME,
      { ...HOME, slug: "about", label: "About", canUpdate: false },
      // A row whose answer says nothing about updating is a refusal, not a guess.
      { ...HOME, slug: "terms", label: "Terms", canUpdate: undefined },
    ]);
    expect(
      within(rowOf("Home")).getByRole("link", { name: "Edit Home" })
    ).toHaveAttribute("href", "/admin/singles/home");
    // 🔴 It opens read-only for this reader, so it is not offered as an edit.
    const about = rowOf("About");
    expect(
      within(about).queryByRole("link", { name: /^Edit/ })
    ).not.toBeInTheDocument();
    expect(
      within(about).getByRole("link", { name: "View About" })
    ).toHaveAttribute("href", "/admin/singles/about");
    expect(
      within(about).getByRole("link", { name: "View About" })
    ).toHaveTextContent("View");
    expect(
      within(rowOf("Terms")).getByRole("link", { name: "View Terms" })
    ).toBeInTheDocument();
  });

  it("says in its subtitle how many collections and Singles the reader may see", () => {
    draw([collectionRow("posts"), HOME], {
      total: 13,
      totalByKind: { collection: 8, single: 5 },
    });
    expect(screen.getByTestId("widget-card-subtitle")).toHaveTextContent(
      /^8 collections · 5 Singles$/
    );
  });

  it.each([
    [{ collection: 1, single: 0 }, "1 collection"],
    [{ collection: 0, single: 1 }, "1 Single"],
    [{ collection: 3 }, "3 collections"],
  ])("writes %o as %s", (totalByKind, said) => {
    draw([collectionRow("posts")], { totalByKind });
    expect(screen.getByTestId("widget-card-subtitle")).toHaveTextContent(
      new RegExp(`^${said}$`)
    );
  });

  it("draws the rows its body holds and nothing under them: no footer, no count, no link to all", () => {
    draw([HOME, ...collectionRows(10)], {
      tier: "medium",
      h: 4,
      total: 14,
      totalByKind: { collection: 13, single: 1 },
    });
    // 🔴 Rows that do not fit are cut, with nothing said under them.
    expect(rows()).toHaveLength(4);
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^View all|^Show all/ })
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .filter(link => link.getAttribute("href") === "/admin/collections")
    ).toEqual([]);
  });

  describe("at a card's width", () => {
    it.each(["medium", "large"] as const)(
      "draws the table at the %s tier, its rows filling a 6 x 4 card's body",
      tier => {
        draw(collectionRows(5), { tier, h: 4 });
        expect(screen.getByTestId("content-table")).toBeInTheDocument();
        expect(screen.queryByTestId("content-list")).not.toBeInTheDocument();
        // 🔴 The frame counts four 52 px rows for this body, and draws them that tall: a
        // shorter row would leave the room of the rows it did not draw empty under them.
        expect(rows()).toHaveLength(4);
        for (const row of rows()) expect(row).toHaveClass("h-13");
      }
    );

    it("keeps every column on a medium card wide enough for them", () => {
      // The default half-width card at 1440: 516 px, its body 482.
      bodyWidth(482);
      draw([collectionRow("posts"), HOME], { tier: "medium" });
      const table = screen.getByTestId("content-table");
      expect(table).not.toHaveAttribute("data-narrow");
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map(h => h.textContent)
      ).toEqual(["Name", "Entries", "Drafts", "Updated", "Actions"]);
    });

    it("on a narrow medium card keeps every column, the + as a smaller icon, and draws Updated short", () => {
      // A card on a 390 px phone: 342 px, its body 308.
      bodyWidth(308);
      draw(
        [
          collectionRow("posts", { singularLabel: "Post" }),
          // An answer that names no singular: the label stands in.
          collectionRow("tags"),
          HOME,
        ],
        { tier: "medium" }
      );
      const table = screen.getByTestId("content-table");
      expect(table).toHaveAttribute("data-narrow", "true");
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map(h => h.textContent)
      ).toEqual(["Name", "Entries", "Drafts", "Updated", "Actions"]);
      // 🔴 Creating stays on the row: the dashboard has nowhere else to start
      // a new entry, so a narrow card must not drop it.
      const create = within(rowOf("Posts")).getByRole("link", {
        name: "Create Post",
      });
      expect(create).toHaveAttribute("href", "/admin/collections/posts/create");
      expect(create).toHaveClass("size-6");
      // An icon alone: no words take the name's room.
      expect(create.textContent).toBe("");
      expect(
        within(rowOf("Tags")).getByRole("link", { name: "Create Tags" })
      ).toHaveAttribute("href", "/admin/collections/tags/create");
      expect(
        within(rowOf("Home")).getByRole("link", { name: "Edit Home" })
      ).toHaveAttribute("href", "/admin/singles/home");
      // "5m"-style, never "5m ago".
      const time = rowOf("Posts").querySelector("time");
      expect(time?.textContent).not.toMatch(/ago|just now/);
      expect(time?.getAttribute("title")).toMatch(/^Saved by Ana, /);
    });

    it("never narrows a large card, however it is measured", () => {
      bodyWidth(308);
      draw([collectionRow("posts")], { tier: "large" });
      expect(screen.getByTestId("content-table")).not.toHaveAttribute(
        "data-narrow"
      );
    });
  });

  describe("a small card, stacked", () => {
    it("draws each name on its own line, with the counts and Updated under it, and no columns", () => {
      draw(
        [
          collectionRow("posts"),
          collectionRow("tags", { draft: null, count: 1 }),
          HOME,
        ],
        { tier: "small" }
      );
      // 🔴 No table: the figures take no width from the names.
      expect(screen.queryByTestId("content-table")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("columnheader")).toEqual([]);
      expect(screen.getByTestId("content-list")).toBeInTheDocument();

      const posts = rowOf("Posts");
      const details = within(posts).getByTestId("content-row-details");
      expect(details).toHaveTextContent(/^9 entries · 2 drafts · \S/);
      // The same links and action as the table's.
      expect(
        within(posts).getByRole("link", { name: "Posts" })
      ).toHaveAttribute("href", "/admin/collections/posts");
      expect(
        within(details).getByRole("link", { name: "2 drafts in Posts" })
      ).toHaveAttribute("href", "/admin/collections/posts?status=draft");
      expect(
        within(posts).getByRole("link", { name: "New entry in Posts" })
      ).toHaveAttribute("href", "/admin/collections/posts/create");
      expect(
        within(details)
          .getByText(/ago|just now|Oct/)
          .getAttribute("title")
      ).toMatch(/^Saved by Ana, /);

      // No drafts named for a collection without the lifecycle; one entry, singular.
      expect(
        within(rowOf("Tags")).getByTestId("content-row-details")
      ).toHaveTextContent(/^1 entry · \S/);

      // 🔴 A Single says "Single" in place of the counts, then its time.
      const home = within(rowOf("Home")).getByTestId("content-row-details");
      expect(home).toHaveTextContent(/^Single · \S/);
      expect(home).not.toHaveTextContent(/entr|draft/);
      expect(
        within(rowOf("Home")).getByRole("link", { name: "Edit Home" })
      ).toHaveAttribute("href", "/admin/singles/home");
    });

    it("keeps the table's order and mutes an empty collection's row", () => {
      draw(
        [
          collectionRow("tags"),
          HOME,
          collectionRow("authors", { count: 0, draft: 0 }),
        ],
        { tier: "small" }
      );
      expect(
        rows().map(row => within(row).getAllByRole("link")[0]?.textContent)
      ).toEqual(["Tags", "Home", "Authors"]);
      expect(rowOf("Authors")).toHaveAttribute("data-empty", "true");
      expect(
        within(rowOf("Authors")).getByRole("link", { name: "Authors" })
      ).toHaveClass("text-muted-foreground");
    });

    it("at four rows high draws the four whole rows its body holds", () => {
      draw(collectionRows(5), { tier: "small", h: 4 });
      expect(rows()).toHaveLength(4);
      for (const row of rows()) expect(row).toHaveClass("h-13");
    });
  });
});
