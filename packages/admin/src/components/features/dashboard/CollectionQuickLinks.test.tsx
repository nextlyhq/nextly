/**
 * The Collections card holds its tiles' places while its counts load.
 *
 * Its tiles used to wait for both its requests behind a four-line placeholder, then draw the
 * whole grid at once: on a phone that pushed every card under it down by the grid's height. The
 * list of collections says which tiles there are, so they are drawn from it, each count's place
 * held, and the counts landing fill tiles already in place.
 */
import { describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";
import {
  NAV_COLLECTIONS_PARAMS,
  useCollections,
  useSingles,
} from "@admin/hooks/queries";

import { CollectionQuickLinks } from "./CollectionQuickLinks";

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollections: vi.fn(),
  useSingles: vi.fn(),
}));

const LIST = ["authors", "posts", "tags"].map(name => ({
  name,
  label: name[0].toUpperCase() + name.slice(1),
}));

/** The list the sidebar shares, and the card's `system:content` answer, as the batch hands it. */
function given({
  list,
  counts,
  failed,
  onRetry,
}: {
  list?: typeof LIST;
  counts?: {
    kind?: "collection" | "single";
    slug: string;
    label: string;
    group: null;
    count?: number;
    draft?: number;
  }[];
  failed?: { error: string; code?: "unavailable" };
  onRetry?: () => void;
}) {
  vi.mocked(useSingles).mockReturnValue({
    data: { items: [] },
  } as unknown as ReturnType<typeof useSingles>);
  vi.mocked(useCollections).mockReturnValue({
    data: list ? { items: list } : undefined,
    isLoading: list === undefined,
  } as unknown as ReturnType<typeof useCollections>);
  const slot = failed
    ? { ok: false as const, ...failed }
    : counts
      ? { ok: true as const, result: { op: "list" as const, items: counts } }
      : undefined;
  render(
    inFrame(
      <CollectionQuickLinks
        widgetId="core/content"
        placementId="core/content"
        settings={{}}
        slot={slot}
        isFetching={slot === undefined}
        {...(onRetry ? { onRetry } : {})}
      />
    )
  );
}

/** The tiles' labels, in the order drawn. */
const tileLabels = () =>
  screen
    .getAllByRole("link")
    .map(link => link.textContent?.replace(/\d|,/g, "").trim());

describe("the Collections card's tiles", () => {
  it("draws a tile for every listed collection while the counts load", () => {
    // 🔴 It drew a four-line placeholder here, and the grid only once both had answered.
    given({ list: LIST });
    expect(screen.queryByTestId("card-skeleton")).not.toBeInTheDocument();
    expect(tileLabels()).toEqual(["Authors", "Posts", "Tags"]);
    // Each count's place is held, not drawn as a number it does not have.
    for (const tile of screen.getAllByRole("link")) {
      expect(within(tile).queryByText(/^\d/)).not.toBeInTheDocument();
      expect(tile.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    }
  });

  it("keeps the list's order once the counts land, and drops a tile with no count", () => {
    // The counts arrive in their own order and without one listed collection: the tiles stay
    // where they were drawn, and the one with no count goes. Closing up, never inserting.
    given({
      list: LIST,
      counts: [
        { slug: "tags", label: "Tags", group: null, count: 3 },
        { slug: "posts", label: "Posts", group: null, count: 13 },
      ],
    });
    expect(tileLabels()).toEqual(["Posts", "Tags"]);
    expect(screen.getByRole("link", { name: /13/ })).toHaveTextContent("Posts");
  });

  it("waits for the list when the counts land first, rather than drawing them in their own order", () => {
    // 🔴 Drawn from the counts alone, the tiles took the counts' order, then re-sorted and
    // regrouped by the list's once it arrived: tiles already on screen moved.
    given({
      counts: [
        { slug: "tags", label: "Tags", group: null, count: 3 },
        { slug: "posts", label: "Posts", group: null, count: 13 },
      ],
    });
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("draws no placeholder tile for a collection kept off the dashboard", () => {
    // 🔴 Drawn from the list first, a hidden collection showed until its count never came.
    given({
      list: [
        ...LIST,
        { name: "audit", label: "Audit", admin: { hidden: true } } as never,
      ],
    });
    expect(tileLabels()).toEqual(["Authors", "Posts", "Tags"]);
  });

  it("names a placeholder tile with the plural, as its count will", () => {
    // 🔴 The list's `label` and the count's plural differ, so the tile's text changed (and
    // could rewrap) when its count landed.
    given({
      list: [
        {
          name: "posts",
          label: "Post",
          labels: { singular: "Post", plural: "Posts" },
        } as never,
      ],
    });
    expect(tileLabels()).toEqual(["Posts"]);
  });

  it("asks for the collections list the sidebar asks for, so the two share one answer", () => {
    // 🔴 It asked with arguments of its own, a second request the shell had not made, so the
    // list was never there when the card was drawn.
    given({ list: LIST });
    expect(useCollections).toHaveBeenCalledWith(NAV_COLLECTIONS_PARAMS);
  });

  it("still says the counts failed, rather than holding their places forever, and offers Retry", () => {
    const onRetry = vi.fn();
    given({ list: LIST, failed: { error: "boom" }, onRetry });
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    screen.getByRole("button", { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says it is not available when its source refused this reader", () => {
    given({
      list: LIST,
      failed: { error: "Not available", code: "unavailable" },
    });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });

  it("draws every collection past the default five", () => {
    const names = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    given({
      list: names.map(name => ({ name, label: name.toUpperCase() })),
      counts: names.map(name => ({
        slug: name,
        label: name.toUpperCase(),
        group: null,
        count: 1,
      })),
    });
    expect(screen.getAllByRole("link")).toHaveLength(7);
    expect(screen.queryByTestId("list-card-footer")).toBeNull();
  });

  it("says there are more past the most it draws, from the one row more", () => {
    const names = Array.from({ length: 50 }, (_, i) => `c${i}`);
    given({
      list: names.map(name => ({ name, label: name })),
      counts: names.map(name => ({
        slug: name,
        label: name,
        group: null,
        count: 1,
      })),
    });
    // The content source has no list view to open, so the footer is plain text, and the extra
    // row says only that at least one more exists.
    expect(screen.getAllByRole("link")).toHaveLength(49);
    expect(screen.getByTestId("list-card-footer")).toHaveTextContent("1+ more");
  });

  it("draws a counted collection the list lacks, after the listed ones", () => {
    // 🔴 Joined on the list, a count for a collection outside the list's page was dropped.
    given({
      list: LIST,
      counts: [
        { slug: "posts", label: "Posts", group: null, count: 13 },
        { slug: "zines", label: "Zines", group: null, count: 2 },
        { slug: "tags", label: "Tags", group: null, count: 3 },
      ],
    });
    expect(tileLabels()).toEqual(["Posts", "Tags", "Zines"]);
  });

  it("draws the most it draws when the list's page and the counts' page differ", () => {
    // Past a hundred collections the list is its first hundred and the counts are their own
    // fifty: here thirty of the fifty are listed and twenty are not.
    const names = Array.from(
      { length: 120 },
      (_, i) => `n${String(i).padStart(3, "0")}`
    );
    given({
      list: names.slice(0, 100).map(name => ({ name, label: name })),
      counts: names.slice(70).map(name => ({
        slug: name,
        label: name,
        group: null,
        count: 1,
      })),
    });
    // The content source has no list view to open, so the footer is plain text, and the extra
    // row says only that at least one more exists.
    expect(screen.getAllByRole("link")).toHaveLength(49);
    expect(screen.getByTestId("list-card-footer")).toHaveTextContent("1+ more");
  });

  it("draws each Single after the collections, linking to it, a Single sharing a collection's slug included", () => {
    // 🔴 Read as collections, Singles were dropped (no count), and one sharing a
    // collection's slug was taken for that collection.
    given({
      list: LIST,
      counts: [
        {
          kind: "collection",
          slug: "posts",
          label: "Posts",
          group: null,
          count: 13,
        },
        { kind: "single", slug: "home", label: "Home page", group: null },
        { kind: "single", slug: "posts", label: "Posts page", group: null },
      ],
    });
    expect(tileLabels()).toEqual(["Posts", "Home page", "Posts page"]);
    expect(screen.getByRole("link", { name: /Home page/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/singles/home")
    );
    // Two groups now, so each is named.
    expect(
      screen.getByRole("heading", { name: /Singles/ })
    ).toBeInTheDocument();
  });

  it("names a collection's drafts beside its entries, and says nothing of none", () => {
    given({
      list: LIST,
      counts: [
        { slug: "authors", label: "Authors", group: null, count: 4, draft: 0 },
        { slug: "posts", label: "Posts", group: null, count: 13, draft: 2 },
      ],
    });
    expect(screen.getByRole("link", { name: /Posts/ })).toHaveTextContent(
      "2 drafts"
    );
    expect(screen.getByRole("link", { name: /Authors/ })).not.toHaveTextContent(
      /draft/
    );
  });

  it("draws the frame's placeholder only while neither answer is known", () => {
    given({});
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
  });
});
