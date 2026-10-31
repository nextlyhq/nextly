/**
 * The dashboard's Team activity card, drawn from its `system:activity`
 * answer: the frame's own states, the rows its tier and its "Number of items"
 * allow, each saying who did what to which entry in the event's own verb and
 * leading to what it is about, and "N+ more" from the one row more the batch
 * asked for.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

import { TeamActivityCard } from "./TeamActivity";

/** The collections the workspace payload publishes to the reader, as a test sets them. */
let mockBranding: { widgetSources?: unknown[] } = {};
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => mockBranding,
}));
afterEach(() => {
  mockBranding = {};
});

/** One feed row as `system:activity` answers it. */
function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `a${n}`,
    actorType: "user",
    userId: "u1",
    userName: "Ana",
    userEmail: "ana@example.test",
    action: "update",
    event: "saved",
    collection: "posts",
    entryId: `p${n}`,
    entryTitle: `Doc ${n}`,
    subjectKind: "collection",
    createdAt: "2026-10-22T12:00:00.000Z",
    count: 1,
    countAtLeast: false,
    identityErasedAt: null,
    ...overrides,
  };
}

const LIST_QUERY = { source: "system:activity", op: "list" as const };

function draw(props: Partial<WidgetComponentProps>, tier: SizeTier = "medium") {
  const full: WidgetComponentProps = {
    widgetId: "core/team-activity",
    placementId: "card-1",
    settings: {},
    slot: undefined,
    isFetching: false,
    ...props,
  };
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(<TeamActivityCard {...full} />, "Team activity")}
    </CardTierContext.Provider>
  );
}

/** The document each drawn row names, in order. */
const titles = () =>
  screen
    .queryAllByTestId("entity-row-title")
    .map(n => /Doc \d+/.exec(n.textContent ?? "")?.[0]);

describe("the Team activity card", () => {
  it("holds its rows' place while its first answer is on the way, and is not available with no request", () => {
    const { unmount } = draw({
      isFetching: true,
      query: { ...LIST_QUERY, limit: 4 },
    });
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
    unmount();

    // A card never asked has nothing to show: the frame's one "not available"
    // state, never a blank card.
    draw({ isFetching: false });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });

  it("says it is not available, or that it failed, in the frame's own words", () => {
    const { unmount } = draw({
      slot: { ok: false, error: "Not available", code: "unavailable" },
    });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    unmount();

    draw({ slot: { ok: false, error: "The database did not answer." } });
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "The database did not answer."
    );
  });

  it("offers Retry on its error, asking the card's question again", () => {
    const onRetry = vi.fn();
    draw({
      slot: { ok: false, error: "The database did not answer." },
      onRetry,
    });
    screen.getByRole("button", { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the standard empty state when there is nothing to show", () => {
    draw({
      slot: { ok: true, result: { op: "list", items: [] } },
      query: LIST_QUERY,
    });
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No activity yet"
    );
  });

  it("draws the rows its reader asked for, and no footer, since the feed has no list to open", () => {
    // Asked for 3: the batch asked 4, and the fourth is not drawn. The feed has no list view to
    // open, and a footer holds a link, never a bare count.
    const { unmount } = draw({
      slot: {
        ok: true,
        result: { op: "list", items: [1, 2, 3, 4].map(n => row(n)) },
      },
      query: { ...LIST_QUERY, limit: 3 },
    });
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
    unmount();

    // And an answer no longer than the rows drawn draws them all, and no footer either.
    draw({
      slot: {
        ok: true,
        result: { op: "list", items: [1, 2, 3].map(n => row(n)) },
      },
      query: { ...LIST_QUERY, limit: 3 },
    });
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
  });

  it("links each row to the entry or Single it is about, and a deletion to nothing", () => {
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [
            row(1),
            row(2, { subjectKind: "single", collection: "home" }),
            // Its subject is gone, so there is nothing to open.
            row(3, { action: "delete" }),
          ],
        },
      },
      query: LIST_QUERY,
    });
    const hrefs = screen
      .getAllByTestId("entity-row-title")
      .map(title => title.closest("a")?.getAttribute("href"));
    expect(hrefs).toEqual([
      "/admin/collections/posts/p1",
      "/admin/singles/home",
      undefined,
    ]);
  });

  it("says what happened in the event's own verb, and a deletion leads nowhere", () => {
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [
            row(1, { action: "create", event: "created" }),
            row(2, { event: "saved" }),
            row(3, { event: "published" }),
            row(4, { event: "unpublished" }),
            row(5, { action: "delete", event: "deleted" }),
          ],
        },
      },
      query: { ...LIST_QUERY, limit: 10 },
    });
    const drawn = screen.getAllByTestId("entity-row-title");
    expect(drawn.map(title => title.textContent)).toEqual([
      "Ana created Doc 1",
      "Ana saved Doc 2",
      "Ana published Doc 3",
      "Ana unpublished Doc 4",
      "Ana deleted Doc 5",
    ]);
    // Every row but the deletion opens its entry.
    expect(drawn.map(title => title.closest("a") !== null)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("says what an older server's row did by its action, when the row names no event", () => {
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [
            row(1, { event: undefined }),
            // An event outside the server's closed set is read as none, never drawn as a verb.
            row(2, { event: "archived" }),
          ],
        },
      },
      query: LIST_QUERY,
    });
    expect(
      screen.getAllByTestId("entity-row-title").map(title => title.textContent)
    ).toEqual(["Ana updated Doc 1", "Ana updated Doc 2"]);
  });

  it("draws no more rows than a small card has room for", () => {
    draw(
      {
        slot: {
          ok: true,
          result: { op: "list", items: [1, 2, 3, 4, 5].map(n => row(n)) },
        },
        query: { ...LIST_QUERY, limit: 10 },
      },
      "small"
    );
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
  });

  it("draws a run of saves with its count, and leaves out a row it cannot read", () => {
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [
            row(1, { count: 12 }),
            // No id: not a row this build can draw, so it is not drawn from guesses.
            row(2, { id: undefined }),
          ],
        },
      },
      query: LIST_QUERY,
    });
    expect(titles()).toEqual(["Doc 1"]);
    // The count's own words: a bare /12/ also matches a relative time such as "12h ago".
    // Seen with its dot in the row's title, and heard with a comma in its spoken form.
    expect(screen.getByTestId("entity-row-title")).toHaveTextContent(
      "Ana saved Doc 1 · 12 times"
    );
    expect(screen.getByText("Ana saved Doc 1, 12 times")).toHaveClass(
      "sr-only"
    );
  });

  it("heads a Single's row by its label, with no collection beside it", () => {
    // A collection's entry names its collection on the meta line; a Single's row
    // has no collection, and drawing its slug there would name one that does not
    // exist. The collection row is the control.
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [
            row(1, {
              subjectKind: "single",
              collection: "site-settings",
              entryTitle: "Site Settings",
            }),
            row(2, { entryTitle: "Hello" }),
          ],
        },
      },
      query: LIST_QUERY,
    });
    const [single, collection] = screen.getAllByTestId("entity-row");
    expect(single).toHaveTextContent("Site Settings");
    expect(single?.textContent).not.toContain("site-settings");
    expect(collection).toHaveTextContent("Hello");
    expect(
      within(collection!).getByTestId("entity-row-meta")
    ).toHaveTextContent("posts");
  });

  it("names an untitled entry's collection by the label it shows, in the title and the meta alike", () => {
    // 🔴 Relabelled on the meta line alone, one row would say "Ana saved blog_posts" over
    // "Blog Posts".
    mockBranding = {
      widgetSources: [
        {
          collection: "blog_posts",
          label: "Blog Posts",
          lifecycle: true,
          fields: [],
        },
      ],
    };
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [row(1, { collection: "blog_posts", entryTitle: null })],
        },
      },
      query: LIST_QUERY,
    });
    const [only] = screen.getAllByTestId("entity-row");
    expect(within(only!).getByTestId("entity-row-title")).toHaveTextContent(
      "Ana saved an entry in Blog Posts"
    );
    expect(within(only!).getByTestId("entity-row-meta")).toHaveTextContent(
      "Blog Posts"
    );
    expect(only).not.toHaveTextContent("blog_posts");
  });

  describe("a deletion", () => {
    const titleOf = (items: Record<string, unknown>[]) => {
      draw({
        slot: { ok: true, result: { op: "list", items } },
        query: { ...LIST_QUERY, limit: 10 },
      });
      return screen
        .getAllByTestId("entity-row-title")
        .map(title => title.textContent);
    };
    const deletion = { action: "delete", event: "deleted" };

    it("names the entry it deleted when the row carries its title", () => {
      expect(
        titleOf([
          row(1, { ...deletion, entryTitle: "Spring launch announcement" }),
        ])
      ).toEqual(["Ana deleted Spring launch announcement"]);
    });

    it("says it deleted an entry in the collection when the row carries no title, never the collection itself", () => {
      // 🔴 "Ana deleted Blog Posts" reads as though the collection went. The server drops a
      // removed document's title and id, so this is how every deletion it redacts arrives.
      mockBranding = {
        widgetSources: [
          {
            collection: "blog_posts",
            label: "Blog Posts",
            lifecycle: true,
            fields: [],
          },
        ],
      };
      expect(
        titleOf([
          row(1, {
            ...deletion,
            collection: "blog_posts",
            entryId: null,
            entryTitle: null,
          }),
        ])
      ).toEqual(["Ana deleted an entry in Blog Posts"]);
    });

    it("names a Single by its label, and says a Single when the row carries none", () => {
      expect(
        titleOf([
          row(1, {
            ...deletion,
            subjectKind: "single",
            collection: "home",
            entryTitle: "Home",
          }),
          row(2, {
            ...deletion,
            subjectKind: "single",
            collection: "gone",
            entryTitle: null,
          }),
        ])
      ).toEqual(["Ana deleted Home", "Ana deleted a Single"]);
    });

    it("leaves a settings change named by its label, since it is about no entry", () => {
      // The control for the wording above: only an entry's row says "an entry in".
      expect(
        titleOf([
          row(1, {
            action: "update",
            event: undefined,
            subjectKind: "settings",
            collection: "email-providers",
            entryId: null,
            entryTitle: null,
          }),
        ])
      ).toEqual(["Ana updated email-providers"]);
    });
  });
});
