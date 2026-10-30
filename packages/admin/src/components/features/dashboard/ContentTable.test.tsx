/**
 * The dashboard's Content table, drawn from its `system:content` answer: its columns in order, a
 * collection's row and a Single's, the + only where the reader may create, Drafts linked to the
 * list's Draft filter, zeros and empty collections muted, the rows a card of width 6 and of
 * width 12 draws, and its one "View all (N)" to the collections, N counting collections alone.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

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

/** One Single's row: no counts, no create decision. */
const HOME = {
  kind: "single",
  slug: "home",
  label: "Home",
  group: null,
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
  { tier = "large", total }: { tier?: SizeTier; total?: number } = {}
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
      },
    },
  };
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(<ContentTable {...props} />, "Content")}
    </CardTierContext.Provider>
  );
}

const rows = () => screen.getAllByTestId("content-table-row");
const rowOf = (label: string) =>
  rows().find(row => within(row).queryByRole("link", { name: label }))!;

describe("the Content table", () => {
  it("heads its columns in order: the collection, Entries, Drafts, Updated, then the action", () => {
    draw([collectionRow("posts")]);
    const headings = within(screen.getByTestId("content-table"))
      .getAllByRole("columnheader")
      .map(heading => heading.textContent);
    expect(headings).toEqual([
      "Collection",
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
    "at width %s draws the rows its %s body holds, and View all (N) to the content index",
    (_width, tier, drawn) => {
      const answered = Array.from({ length: 11 }, (_, i) =>
        collectionRow(`c${String(i).padStart(2, "0")}`)
      );
      draw(answered, { tier, total: 14 });
      expect(rows()).toHaveLength(drawn);
      const viewAll = screen.getByRole("link", { name: /^View all/ });
      expect(viewAll).toHaveTextContent("View all (14)");
      expect(viewAll).toHaveAttribute("href", "/admin/collections");
    }
  );

  it("counts only collections in View all (N), a Single's row drawn among them", () => {
    // Ten collections in all; the large body draws ten rows, one of them a Single, so it draws nine
    // of the ten collections.
    const answered = [
      HOME,
      ...Array.from({ length: 10 }, (_, i) => collectionRow(`c${i}`)),
    ];
    draw(answered, { tier: "large", total: 10 });
    expect(rows()).toHaveLength(10);
    const viewAll = screen.getByRole("link", { name: /^View all/ });
    // 🔴 Compared with the collections drawn, not the rows: the rows drawn are ten, as many as
    // the total, and the collections page still holds one more than the card shows.
    expect(viewAll).toHaveTextContent("View all (10)");
    expect(viewAll).toHaveAttribute("href", "/admin/collections");
  });

  it("offers no View all where the reader has Singles and no collection", () => {
    draw([HOME], { total: 0 });
    expect(rowOf("Home")).toBeDefined();
    // 🔴 The collections page would be empty: no link to it at all.
    expect(
      screen.queryByRole("link", { name: /^View all/ })
    ).not.toBeInTheDocument();
  });

  it("still offers the content index when it draws every row", () => {
    draw([collectionRow("posts")], { total: 1 });
    const viewAll = screen.getByRole("link", { name: /^View all/ });
    // No "(N)" when every row is drawn: the link alone.
    expect(viewAll.textContent).not.toContain("(");
    expect(viewAll).toHaveAttribute("href", "/admin/collections");
  });
});
