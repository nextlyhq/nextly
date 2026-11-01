/**
 * The dashboard's Team activity card, drawn from the rows its `load` read from
 * `system:activity`: the rows its tier and its "Number of items" allow, each
 * saying who did what to which entry in the event's own verb and leading to
 * what it is about, and its own empty state. The frame draws loading, no
 * permission and error before the component is reached, so those are the
 * frame's own tests.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { CoreListWidgetData } from "nextly/core-widget-data";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

import { TeamActivityCard, type TeamActivityCardProps } from "./TeamActivity";

/** One row of the card's data, as JSON carries it. */
type Row = CoreListWidgetData["items"][number];

/** A row's field, as JSON carries it, or `undefined` for one it leaves out. */
type Field = Row[string] | undefined;

/** The collections the workspace payload publishes to the reader, as a test sets them. */
let mockBranding: { widgetSources?: unknown[] } = {};
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => mockBranding,
}));
afterEach(() => {
  mockBranding = {};
});

/**
 * One feed row as `system:activity` answers it, as JSON carries it: a field an
 * override leaves `undefined` is not there at all.
 */
function row(n: number, overrides: Record<string, Field> = {}): Row {
  const fields: Record<string, Field> = {
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
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, Row[string]] => entry[1] !== undefined
    )
  );
}

function draw(
  items: readonly Row[],
  { limit, tier = "medium" }: { limit?: number; tier?: SizeTier } = {}
) {
  const full: TeamActivityCardProps = {
    widgetId: "core/team-activity",
    placementId: "card-1",
    settings: limit === undefined ? {} : { limit },
    size: { w: 6, h: 5, tier },
    refreshing: false,
    retry: () => undefined,
    data: { items },
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
  it("uses the standard empty state when there is nothing to show", () => {
    draw([]);
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No activity yet"
    );
  });

  it("draws the rows its reader asked for, and no footer, since the feed has no list to open", () => {
    // Asked for 3: its `load` asked 4, and the fourth is not drawn. The feed has no list view to
    // open, and a footer holds a link, never a bare count.
    const { unmount } = draw(
      [1, 2, 3, 4].map(n => row(n)),
      { limit: 3 }
    );
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
    unmount();

    // And an answer no longer than the rows drawn draws them all, and no footer either.
    draw(
      [1, 2, 3].map(n => row(n)),
      { limit: 3 }
    );
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
  });

  it("links each row to the entry or Single it is about, and a deletion to nothing", () => {
    draw([
      row(1),
      row(2, { subjectKind: "single", collection: "home" }),
      // Its subject is gone, so there is nothing to open.
      row(3, { action: "delete" }),
    ]);
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
    draw(
      [
        row(1, { action: "create", event: "created" }),
        row(2, { event: "saved" }),
        row(3, { event: "published" }),
        row(4, { event: "unpublished" }),
        row(5, { action: "delete", event: "deleted" }),
      ],
      { limit: 10 }
    );
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
    draw([
      row(1, { event: undefined }),
      // An event outside the server's closed set is read as none, never drawn as a verb.
      row(2, { event: "archived" }),
    ]);
    expect(
      screen.getAllByTestId("entity-row-title").map(title => title.textContent)
    ).toEqual(["Ana updated Doc 1", "Ana updated Doc 2"]);
  });

  it("draws no more rows than a small card has room for", () => {
    draw(
      [1, 2, 3, 4, 5].map(n => row(n)),
      { limit: 10, tier: "small" }
    );
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
  });

  it("draws a run of saves with its count, and leaves out a row it cannot read", () => {
    draw([
      row(1, { count: 12 }),
      // No id: not a row this build can draw, so it is not drawn from guesses.
      row(2, { id: undefined }),
    ]);
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
    draw([
      row(1, {
        subjectKind: "single",
        collection: "site-settings",
        entryTitle: "Site Settings",
      }),
      row(2, { entryTitle: "Hello" }),
    ]);
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
    draw([row(1, { collection: "blog_posts", entryTitle: null })]);
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
    const titleOf = (items: readonly Row[]) => {
      draw(items, { limit: 10 });
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
