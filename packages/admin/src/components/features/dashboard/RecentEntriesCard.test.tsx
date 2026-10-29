/**
 * The Recent entries card at each width: titles alone when small, when each was updated and its
 * status when medium, a table when large; every row a link to its entry at every width, and,
 * when the collection holds more than the card draws, "View all (N)" to the collection's list
 * under the card's Filter and Sort.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { MAX_CHOSEN_FIELDS } from "nextly/config";
import type { WidgetSlot } from "nextly/widget-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";

import { MAX_META_FIELDS } from "../widgets/frame/entity-row";
import { CardTierContext } from "../widgets/frame/tier";

import { RecentEntriesCard } from "./RecentEntriesCard";

/** Posts as the workspace payload publishes them: a collection with a lifecycle. */
const PUBLISHED = {
  widgetSources: [
    { collection: "posts", label: "Posts", lifecycle: true, fields: [] },
  ],
};
/** The collections the workspace payload publishes to the reader, as a test sets them. */
let mockBranding: { widgetSources?: unknown[] } = PUBLISHED;
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => mockBranding,
}));
afterEach(() => {
  mockBranding = PUBLISHED;
});

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
    "offers View all with no count when %s and it draws every entry there is",
    tier => {
      // The way to the collection's list is always in the footer; the count only says more.
      drawAt(tier);
      expect(screen.getAllByRole("link", { name: /^Story/ })).toHaveLength(4);
      const footer = screen.getByTestId("list-card-footer");
      expect(footer).toHaveTextContent(/^View all/);
      expect(footer.textContent).not.toMatch(/\(\d/);
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
    // In the order the server answered the columns, as the card asked them.
    expect(headings).toEqual(["Headline", "Status", "Updated"]);
  });

  it("leads each row with the initial of its collection's label, not its slug", () => {
    // 🔴 Posts are published to this reader as "Articles": a chip read off the slug says "P".
    mockBranding = {
      widgetSources: [
        {
          collection: "posts",
          label: "Articles",
          lifecycle: false,
          fields: [],
        },
      ],
    };
    drawAt("medium");
    const leading = screen
      .getAllByTestId("entity-row")
      .map(each => within(each).getByTestId("entity-row-leading").textContent);
    expect(leading.length).toBeGreaterThan(0);
    expect(new Set(leading)).toEqual(new Set(["A"]));
  });

  it("draws its status as a pill, in the tone of done for a published entry", () => {
    drawAt("medium", {
      ok: true,
      result: {
        op: "list",
        items: [
          { id: "e1", headline: "Story 1", status: "published" },
          { id: "e2", headline: "Story 2", status: "draft" },
        ],
        fields: [
          { name: "headline", label: "Headline", type: "string" },
          {
            name: "status",
            label: "Status",
            type: "string",
            choices: [
              { value: "published", label: "Published" },
              { value: "draft", label: "Draft" },
            ],
          },
        ],
      },
    });
    // 🔴 One tone for both says nothing about which is live.
    const pills = screen
      .getAllByTestId("status-pill")
      .map(pill => [pill.textContent, pill.dataset.tone]);
    expect(pills).toEqual([
      ["Published", "good"],
      ["Draft", "neutral"],
    ]);
  });

  it("shows the fields its reader chose, each on the meta line or at the row's end", () => {
    // Chosen in the card's Fields: a topic, which has no choices, joins the meta line.
    const chosen: WidgetSlot = {
      ok: true,
      result: {
        op: "list",
        items: [{ id: "e1", headline: "Story 1", topic: "Plans" }],
        fields: [
          { name: "headline", label: "Headline", type: "string" },
          { name: "topic", label: "Topic", type: "string" },
        ],
      },
    };
    drawAt("medium", chosen);
    const [row] = screen.getAllByTestId("entity-row");
    expect(within(row!).getByTestId("entity-row-meta")).toHaveTextContent(
      "Plans"
    );
    expect(within(row!).queryByTestId("entity-row-trailing")).toBeNull();
  });

  it("keeps the order the reader chose in the table, a field of choices included", () => {
    // 🔴 Sorted by role, the stage (a field of choices) moved behind the topic.
    drawAt("large", {
      ok: true,
      result: {
        op: "list",
        items: [
          { id: "e1", headline: "Story 1", stage: "open", topic: "Plans" },
        ],
        fields: [
          { name: "headline", label: "Headline", type: "string" },
          {
            name: "stage",
            label: "Stage",
            type: "string",
            choices: [{ value: "open", label: "Open" }],
          },
          { name: "topic", label: "Topic", type: "string" },
        ],
      },
    });
    expect(
      screen.getAllByRole("columnheader").map(heading => heading.textContent)
    ).toEqual(["Headline", "Stage", "Topic"]);
  });

  it("reads a field named status as any other on a collection without a lifecycle", () => {
    // 🔴 Judged by the field's name, an author's own `status` choice field was
    // drawn as the lifecycle's pill, "published" in the tone of done.
    mockBranding = {
      widgetSources: [
        { collection: "posts", label: "Posts", lifecycle: false, fields: [] },
      ],
    };
    drawAt("medium", {
      ok: true,
      result: {
        op: "list",
        items: [{ id: "e1", headline: "Story 1", status: "published" }],
        fields: [
          { name: "headline", label: "Headline", type: "string" },
          {
            name: "status",
            label: "Status",
            type: "string",
            choices: [{ value: "published", label: "Published" }],
          },
        ],
      },
    });
    const [row] = screen.getAllByTestId("entity-row");
    expect(within(row!).getByText("Published")).toBeInTheDocument();
    expect(within(row!).queryByTestId("status-pill")).toBeNull();
  });

  it("never lets a reader choose more fields than a row's meta line shows", () => {
    // Every chosen field shows at every size only while the cap fits the meta line.
    expect(MAX_CHOSEN_FIELDS).toBeLessThanOrEqual(MAX_META_FIELDS);
  });
});
