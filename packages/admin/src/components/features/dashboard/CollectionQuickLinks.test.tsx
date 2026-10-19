/**
 * The Collections card holds its tiles' places while its counts load.
 *
 * Its tiles used to wait for both its requests behind a four-line placeholder, then draw the
 * whole grid at once: on a phone that pushed every card under it down by the grid's height. The
 * list of collections says which tiles there are, so they are drawn from it, each count's place
 * held, and the counts landing fill tiles already in place.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import {
  NAV_COLLECTIONS_PARAMS,
  useCollections,
  useDashboardStats,
} from "@admin/hooks/queries";

import { CollectionQuickLinks } from "./CollectionQuickLinks";

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useCollections: vi.fn(),
  useDashboardStats: vi.fn(),
}));

const LIST = ["authors", "posts", "tags"].map(name => ({
  name,
  label: name[0].toUpperCase() + name.slice(1),
}));

function given({
  list,
  counts,
  statsError = null,
}: {
  list?: typeof LIST;
  counts?: { slug: string; label: string; group: null; count: number }[];
  statsError?: Error | null;
}) {
  vi.mocked(useCollections).mockReturnValue({
    data: list ? { items: list } : undefined,
    isLoading: list === undefined,
  } as unknown as ReturnType<typeof useCollections>);
  vi.mocked(useDashboardStats).mockReturnValue({
    data: counts ? { collectionCounts: counts } : undefined,
    isLoading: counts === undefined && statsError === null,
    error: statsError,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDashboardStats>);
  render(<CollectionQuickLinks />);
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

  it("asks for the collections list the sidebar asks for, so the two share one answer", () => {
    // 🔴 It asked with arguments of its own, a second request the shell had not made, so the
    // list was never there when the card was drawn.
    given({ list: LIST });
    expect(useCollections).toHaveBeenCalledWith(NAV_COLLECTIONS_PARAMS);
  });

  it("still says the counts failed, rather than holding their places forever", () => {
    given({ list: LIST, statsError: new Error("boom") });
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
  });

  it("draws the frame's placeholder only while neither answer is known", () => {
    given({});
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
  });
});
