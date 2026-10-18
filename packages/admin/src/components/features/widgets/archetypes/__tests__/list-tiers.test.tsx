/**
 * A list card at each tier: how many rows it draws, and when it says more exist.
 *
 * The card's query asks one row more than its tier draws, so an answer holding that extra row
 * is the only sign more exist; an answer of exactly the rows drawn has nothing more to point
 * to. A list from one collection points to that collection's list view, with the card's own
 * filter and sort; a list without one collection says that more exist and links nowhere.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { CardTierContext } from "../../frame/tier";
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

function drawAt(
  tier: SizeTier,
  count: number,
  definition: Parameters<typeof listBody>[1] = recentPosts
) {
  const outcome = listBody(
    { op: "list", items: items(count) } as never,
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
  it("draws three rows at small, titles only", () => {
    drawAt("small", 4);
    expect(screen.getAllByTestId("widget-list-row")).toHaveLength(3);
    // Small is title only: the detail line is medium's.
    expect(screen.queryByText("draft")).not.toBeInTheDocument();
  });

  it("draws the card's number of items at medium, with a line of detail", () => {
    drawAt("medium", 6);
    expect(screen.getAllByTestId("widget-list-row")).toHaveLength(5);
    expect(screen.getAllByText("draft")).toHaveLength(5);
  });
});

describe("saying more exist", () => {
  it("says nothing when the answer holds exactly the rows the tier draws", () => {
    // 🔴 The separating case: a card that always showed the link, or showed it on a full page,
    // fails here; one that never showed it fails the case below.
    drawAt("small", 3);
    expect(
      screen.queryByRole("link", { name: /more exist/i })
    ).not.toBeInTheDocument();
  });

  it("links to the collection's list view with the card's filter and sort when there are more", () => {
    drawAt("small", 4);
    const link = screen.getByRole("link", { name: /more exist/i });
    const href = new URL(link.getAttribute("href") ?? "", "http://admin.test");
    expect(href.pathname).toBe("/admin/collections/posts");
    expect(JSON.parse(href.searchParams.get("where") ?? "null")).toEqual(where);
    expect(href.searchParams.get("sort")).toBe("-updatedAt");
  });

  it("says more exist without a link for a list that is not one collection's", () => {
    drawAt("medium", 6, recentActivity);
    const list = screen.getByTestId("widget-list");
    expect(
      within(list.parentElement ?? list).getByText(/more exist/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /more exist/i })
    ).not.toBeInTheDocument();
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
    expect(screen.getByTestId("widget-table")).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("widget-table-heading")
        .map(node => node.textContent)
    ).toEqual(["Title", "Status"]);
  });

  it("draws a table card at the medium tier as a list, its first column heading each row", () => {
    const table = { ...recentPosts, archetype: "table" } as Parameters<
      typeof listBody
    >[1];
    drawBody(tableBody, "medium", table);
    expect(screen.queryByTestId("widget-table")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-list-row")).toHaveLength(2);
    expect(screen.getByText("Post 1")).toBeInTheDocument();
  });
});
