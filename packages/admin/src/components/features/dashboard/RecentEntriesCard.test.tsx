/**
 * The Recent entries card at each width: titles alone when small, a line of status and when
 * updated when medium, a table when large; every row a link to its entry at every width, and a
 * "View all" link to the collection's list under the card's Filter and Sort.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { RecentEntriesCard } from "./RecentEntriesCard";

const FILTER = { headline: { contains: "news" } };

const QUERY = {
  source: "collection:posts",
  op: "list" as const,
  status: "all" as const,
  select: ["headline", "status", "updatedAt"],
  sort: "-updatedAt",
  where: FILTER,
  limit: 6,
};

const SLOT: WidgetSlot = {
  ok: true,
  result: {
    op: "list",
    items: [1, 2, 3, 4].map(n => ({
      id: `e${n}`,
      headline: `Story ${n}`,
      status: "published",
      updatedAt: "2026-10-20T09:00:00.000Z",
    })),
    fields: [
      { name: "headline", label: "Headline", type: "string" },
      {
        name: "status",
        label: "Status",
        type: "string",
        choices: [{ value: "published", label: "Published" }],
      },
      { name: "updatedAt", label: "Updated", type: "date" },
    ],
  },
};

function drawAt(tier: SizeTier) {
  render(
    <CardTierContext.Provider value={tier}>
      <RecentEntriesCard
        widgetId="core/recent-entries"
        placementId="p1"
        settings={{ collection: "posts", filter: FILTER }}
        slot={SLOT}
        query={QUERY}
        isFetching={false}
      />
    </CardTierContext.Provider>
  );
}

describe("the Recent entries card", () => {
  it.each(["small", "medium", "large"] as const)(
    "links every row to its entry when %s",
    tier => {
      drawAt(tier);
      const story = screen.getByRole("link", { name: "Story 1" });
      expect(story).toHaveAttribute("href", "/admin/collections/posts/e1");
    }
  );

  it.each(["small", "medium", "large"] as const)(
    "offers View all when %s, opening the list under the card's Filter and Sort",
    tier => {
      drawAt(tier);
      const href =
        screen.getByRole("link", { name: "View all" }).getAttribute("href") ??
        "";
      const url = new URL(href, "http://admin.test");
      expect(url.pathname).toBe("/admin/collections/posts");
      expect(JSON.parse(url.searchParams.get("where") ?? "null")).toEqual(
        FILTER
      );
      expect(url.searchParams.get("sort")).toBe("-updatedAt");
    }
  );

  it("lists titles alone when small, three of them", () => {
    drawAt("small");
    const list = screen.getByTestId("widget-list");
    expect(within(list).getAllByTestId("widget-list-row")).toHaveLength(3);
    expect(within(list).queryByText(/Published/)).not.toBeInTheDocument();
  });

  it("adds each row's status and when it was updated when medium", () => {
    drawAt("medium");
    const [first] = screen.getAllByTestId("widget-list-row");
    expect(first).toHaveTextContent(/Published · /);
  });

  it("is a table headed by the server's own columns when large", () => {
    drawAt("large");
    const headings = screen
      .getAllByTestId("widget-table-heading")
      .map(heading => heading.textContent);
    expect(headings).toEqual(["Headline", "Status", "Updated"]);
  });
});
