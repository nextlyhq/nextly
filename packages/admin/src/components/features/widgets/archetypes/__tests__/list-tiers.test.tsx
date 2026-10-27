/**
 * A list card at each tier: how many rows it draws, and when its footer says there are more.
 *
 * The card's query asks one row more than its tier draws, so without a total an answer holding
 * that extra row is the only sign more exist; an answer of exactly the rows drawn has nothing
 * more to point to. A list from one collection points to that collection's list view, with the
 * card's own filter and sort, as "View all (N)"; a list without one collection says how many
 * more there are and links nowhere.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { AnswerSizeContext, CardTierContext } from "../../frame/tier";
import { listViewHref } from "../../frame/list-view-href";
import { listBody } from "../list";
import { tableBody } from "../table";

afterEach(() => cleanup());

const where = { status: { equals: "draft" } };

const recentPosts = {
  id: "core/recent-posts",
  title: "Recent posts",
  archetype: "list",
  query: {
    source: "collection:posts",
    op: "list",
    select: ["title", "status"],
    where,
    sort: "-updatedAt",
    limit: 5,
  },
} as unknown as Parameters<typeof listBody>[1];

const recentActivity = {
  ...recentPosts,
  id: "core/recent-activity",
  title: "Recent activity",
  query: { source: "system:activity", op: "list", select: ["title"], limit: 5 },
} as unknown as Parameters<typeof listBody>[1];

function items(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Post ${i + 1}`,
    status: "draft",
  }));
}

/** The columns the server describes for `recentPosts`' rows. */
const described = [{ name: "title" }, { name: "status" }];

function drawAt(
  tier: SizeTier,
  count: number,
  definition: Parameters<typeof listBody>[1] = recentPosts,
  total?: number
) {
  const outcome = listBody(
    {
      op: "list",
      items: items(count),
      fields: described,
      ...(total !== undefined && { total }),
    } as never,
    definition
  );
  if (!outcome.ok || !("node" in outcome) || !outcome.node) {
    throw new Error("the list drew nothing");
  }
  render(
    <CardTierContext.Provider value={tier}>
      {outcome.node}
    </CardTierContext.Provider>
  );
}

describe("a list card's rows at each tier", () => {
  it("draws three rows at small", () => {
    drawAt("small", 4);
    expect(screen.getAllByTestId("entity-row")).toHaveLength(3);
  });

  it("draws a row's meta at small too, stacked in its fixed-height row", () => {
    drawAt("small", 4);
    // Every tier below large stacks the row's slots, so a small card keeps the detail a
    // medium one shows; only the number of rows is the small tier's own.
    expect(screen.getAllByTestId("entity-row")).toHaveLength(3);
    expect(
      screen.getAllByTestId("entity-row-meta").map(node => node.textContent)
    ).toEqual(Array(3).fill("draft"));
  });

  it("draws the card's number of items at medium, with a line of detail", () => {
    drawAt("medium", 6);
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(
      screen.getAllByTestId("entity-row-meta").map(node => node.textContent)
    ).toEqual(Array(5).fill("draft"));
  });

  it("draws ten rows at large, however many items the card asks for", () => {
    const many = {
      ...recentPosts,
      query: { ...recentPosts.query, limit: 25 },
    } as unknown as Parameters<typeof listBody>[1];
    drawAt("large", 26, many);
    // Large draws the rows as a table, one row per item.
    expect(screen.getAllByTestId("list-card-table-row")).toHaveLength(10);
  });
});

describe("saying there are more", () => {
  it("has no footer when the answer holds exactly the rows the tier draws", () => {
    // 🔴 The separating case: a card that always showed the footer, or showed it on a full
    // page, fails here; one that never showed it fails the cases below.
    drawAt("small", 3);
    expect(screen.getAllByTestId("entity-row")).toHaveLength(3);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
  });

  it("links to the collection's list view with the card's filter and sort when there are more", () => {
    drawAt("small", 4);
    const link = screen.getByRole("link", { name: /view all/i });
    // No total from the source: the extra row says only that at least four exist.
    expect(link).toHaveTextContent("View all (4+)");
    const href = new URL(link.getAttribute("href") ?? "", "http://admin.test");
    expect(href.pathname).toBe("/admin/collections/posts");
    expect(JSON.parse(href.searchParams.get("where") ?? "null")).toEqual(where);
    expect(href.searchParams.get("sort")).toBe("-updatedAt");
  });

  it("counts every row the list holds when the source gave its total", () => {
    drawAt("small", 4, recentPosts, 42);
    expect(screen.getByRole("link", { name: /view all/i })).toHaveTextContent(
      "View all (42)"
    );
  });

  it("has no footer when the source's total is the rows it draws", () => {
    // The total, not the extra row, decides: three in all is everything a small card draws.
    drawAt("small", 3, recentPosts, 3);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
  });

  it("says how many more without a link for a list that is not one collection's", () => {
    drawAt("medium", 6, recentActivity);
    const footer = screen.getByTestId("list-card-footer");
    expect(footer.tagName).toBe("P");
    expect(within(footer).getByText("1+ more")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("the large tier draws a table, and below it a table card is a list", () => {
  const fields = [
    { name: "title", label: "Title" },
    { name: "status", label: "Status" },
  ];

  function drawBody(
    body: typeof listBody,
    tier: SizeTier,
    definition: Parameters<typeof listBody>[1]
  ) {
    const outcome = body(
      { op: "list", items: items(2), fields } as never,
      definition
    );
    if (!outcome.ok || !("node" in outcome) || !outcome.node) {
      throw new Error("the card drew nothing");
    }
    render(
      <CardTierContext.Provider value={tier}>
        {outcome.node}
      </CardTierContext.Provider>
    );
  }

  it("draws a list card at the large tier as a table with readable headings", () => {
    drawBody(listBody, "large", recentPosts);
    expect(screen.getByTestId("list-card-table")).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map(node => node.textContent)
    ).toEqual(["Title", "Status"]);
  });

  it("draws a table card at the medium tier as a list, its first column heading each row", () => {
    const table = { ...recentPosts, archetype: "table" } as Parameters<
      typeof listBody
    >[1];
    drawBody(tableBody, "medium", table);
    expect(screen.queryByTestId("list-card-table")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("entity-row")).toHaveLength(2);
    expect(screen.getAllByTestId("entity-row-title")[0]).toHaveTextContent(
      "Post 1"
    );
  });
});

describe("the lifecycle a View all link carries", () => {
  // The card's rows are bounded by its lifecycle status as well as its filter, and the list view
  // shows every entry unless told otherwise, so the link says which entries the card was drawn
  // from. An omitted status is the widget read's default, published.
  const statusOf = (status: "draft" | "published" | "all" | undefined) => {
    const href = listViewHref({
      source: "collection:posts",
      op: "list",
      status,
    } as never);
    return new URL(href ?? "", "http://admin.test").searchParams.get("status");
  };

  it("names the card's own status", () => {
    expect(statusOf("draft")).toBe("draft");
    expect(statusOf("published")).toBe("published");
  });

  it("names published for a card that left its status to the default", () => {
    expect(statusOf(undefined)).toBe("published");
  });

  it("names none for a card that read every entry", () => {
    expect(statusOf("all")).toBeNull();
  });
});

describe("an answer smaller than the card", () => {
  it("draws the rows its answer was asked for, and says there are more", () => {
    // Fetched for a small card (three rows and one more), shown on a card that has since grown to
    // medium while its larger answer is out or was refused: the extra row is not an item.
    const outcome = listBody(
      { op: "list", items: items(4), fields: described } as never,
      recentPosts
    );
    if (!outcome.ok || !("node" in outcome) || !outcome.node)
      throw new Error("drew nothing");
    render(
      <CardTierContext.Provider value="medium">
        <AnswerSizeContext.Provider value={{ tier: "small" }}>
          {outcome.node}
        </AnswerSizeContext.Provider>
      </CardTierContext.Provider>
    );
    expect(screen.getAllByTestId("entity-row")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /view all/i })).toHaveTextContent(
      "View all (4+)"
    );
  });
});
