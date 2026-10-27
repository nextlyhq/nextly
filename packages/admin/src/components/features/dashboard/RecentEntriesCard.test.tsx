/**
 * The Recent entries card at each width: titles alone when small, when each was updated and its
 * status when medium, a table when large; every row a link to its entry at every width, and,
 * when the collection holds more than the card draws, "View all (N)" to the collection's list
 * under the card's Filter and Sort.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
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

/** Three hours before the test runs, which the card reads as "3h ago". */
const UPDATED = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

/** The card's answer: four entries, and the read's own count of them when it gave one. */
function answered(total?: number): WidgetSlot {
  return {
    ok: true,
    result: {
      op: "list",
      items: [1, 2, 3, 4].map(n => ({
        id: `e${n}`,
        headline: `Story ${n}`,
        status: "published",
        updatedAt: UPDATED,
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
      ...(total !== undefined && { total }),
    },
  };
}

const SLOT = answered();

/** The same answer, from a read that counted 42 entries in all. */
const COUNTED = answered(42);

function drawAt(tier: SizeTier, slot: WidgetSlot = SLOT) {
  render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <RecentEntriesCard
          widgetId="core/recent-entries"
          placementId="p1"
          settings={{ collection: "posts", filter: FILTER }}
          slot={slot}
          query={QUERY}
          isFetching={false}
        />
      )}
    </CardTierContext.Provider>
  );
}

describe("the Recent entries card", () => {
  it.each(["small", "medium", "large"] as const)(
    "links every row to its entry when %s",
    tier => {
      drawAt(tier);
      // The title is inside the link the row is, so the link is named by it.
      const story = screen.getByText("Story 1").closest("a");
      expect(story).toHaveAttribute("href", "/admin/collections/posts/e1");
    }
  );

  it.each(["small", "medium", "large"] as const)(
    "offers View all (N) when %s and the collection holds more, opening the list under the card's Filter and Sort",
    tier => {
      drawAt(tier, COUNTED);
      const viewAll = screen.getByRole("link", { name: /^View all/ });
      expect(viewAll).toHaveTextContent("View all (42)");
      const url = new URL(
        viewAll.getAttribute("href") ?? "",
        "http://admin.test"
      );
      expect(url.pathname).toBe("/admin/collections/posts");
      expect(JSON.parse(url.searchParams.get("where") ?? "null")).toEqual(
        FILTER
      );
      expect(url.searchParams.get("sort")).toBe("-updatedAt");
    }
  );

  it("counts View all as a floor from the extra row when the read gave no total", () => {
    // Four entries asked as six: a small card draws three, and the fourth says at least four.
    drawAt("small");
    expect(screen.getByRole("link", { name: /^View all/ })).toHaveTextContent(
      "View all (4+)"
    );
  });

  it.each(["medium", "large"] as const)(
    "offers no View all when %s and it draws every entry there is",
    tier => {
      drawAt(tier);
      expect(screen.getAllByRole("link", { name: /^Story/ })).toHaveLength(4);
      expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
    }
  );

  it("lists three entries when small", () => {
    drawAt("small");
    const list = screen.getByTestId("list-card-rows");
    expect(within(list).getAllByTestId("entity-row")).toHaveLength(3);
  });

  it("keeps each row's status when small, in its three rows", () => {
    // Below large a row's slots stack the same way at every width: small draws fewer rows,
    // each saying what a medium one says.
    drawAt("small");
    const rows = screen.getAllByTestId("entity-row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0]).getByTestId("entity-row-trailing")
    ).toHaveTextContent("Published");
  });

  it("adds when each row was updated, and its status, when medium", () => {
    drawAt("medium");
    const [first] = screen.getAllByTestId("entity-row");
    expect(within(first).getByTestId("entity-row-meta")).toHaveTextContent(
      "3h ago"
    );
    expect(within(first).getByTestId("entity-row-trailing")).toHaveTextContent(
      "Published"
    );
  });

  it("is a table headed by the server's own column labels when large", () => {
    drawAt("large");
    const headings = screen
      .getAllByRole("columnheader")
      .map(heading => heading.textContent);
    expect(headings).toEqual(["Headline", "Updated", "Status"]);
  });
});
