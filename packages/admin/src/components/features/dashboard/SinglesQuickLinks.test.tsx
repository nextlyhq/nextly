/**
 * The singles card draws what it has, and never hides itself.
 *
 * Whether the card is OFFERED is the host's decision, made through the
 * `singles:present` condition on its declaration. The card used to make that
 * decision too, returning nothing when its list was empty — and a card that
 * renders nothing still holds its grid placement, so the layout reserved an
 * empty slot on every install that never used singles. This guards the
 * removal: an empty list draws the section, because a card the host offered
 * is a card the host wants drawn.
 *
 * @module components/features/dashboard/SinglesQuickLinks.test
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { useSingles } from "@admin/hooks/queries";

const singlesHook = vi.fn<typeof useSingles>();

vi.mock("@admin/hooks/queries", () => ({
  useSingles: (...args: Parameters<typeof useSingles>) => singlesHook(...args),
}));

const { SinglesQuickLinks } = await import("./SinglesQuickLinks");

function listing(
  items: Array<{
    id: string;
    slug: string;
    label?: string;
    admin?: { hidden?: boolean };
  }>,
  extra: { isLoading?: boolean; error?: Error; hasNext?: boolean } = {}
): ReturnType<typeof useSingles> {
  return {
    data: {
      items,
      meta: { total: items.length, hasNext: extra.hasNext ?? false },
    },
    isLoading: extra.isLoading ?? false,
    error: extra.error ?? null,
  } as unknown as ReturnType<typeof useSingles>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the singles card", () => {
  it("draws its section even when the list is empty", () => {
    // 🔴 The reserved-slot guard. Returning `null` here is what the host's
    // condition replaced, and it is the one line a tidy-minded edit would put
    // back. The card's frame (its title and region) is drawn around this body,
    // so what is asserted is that the body still renders with no singles.
    singlesHook.mockReturnValue(listing([]));
    render(<SinglesQuickLinks />);

    // The frame's empty state, which says what will appear: a blank body would also satisfy
    // "rendered something and no links", so the state itself is what is asserted.
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No Singles yet"
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("draws one card per single it was given", () => {
    // The must-differ half: a section that ignored its data would satisfy the
    // case above and draw the same thing for an install with singles.
    singlesHook.mockReturnValue(
      listing([
        { id: "1", slug: "homepage", label: "Homepage" },
        { id: "2", slug: "footer", label: "Footer" },
      ])
    );
    render(<SinglesQuickLinks />);

    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("leaves out a Single kept off the dashboard", () => {
    // `internal: true` is stored as `admin.hidden`, so a hidden Single stands for both.
    singlesHook.mockReturnValue(
      listing([
        { id: "1", slug: "homepage", label: "Homepage" },
        {
          id: "2",
          slug: "nx_pb_flags",
          label: "Flags",
          admin: { hidden: true },
        },
      ])
    );
    render(<SinglesQuickLinks />);

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("Flags")).toBeNull();
  });

  it("does not claim there are no Singles when the hidden ones filled the page read", () => {
    // Only the first page is read. Every Single on it is kept off the dashboard, and more pages
    // exist, so "No Singles yet" would be false: the card points at the full list instead.
    singlesHook.mockReturnValue(
      listing(
        [
          {
            id: "1",
            slug: "nx_pb_flags",
            label: "Flags",
            admin: { hidden: true },
          },
        ],
        { hasNext: true }
      )
    );
    render(<SinglesQuickLinks />);

    expect(screen.queryByText("No Singles yet")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Singles" })
    ).toBeInTheDocument();
  });

  it("wraps a long Single name rather than cutting it", () => {
    // R-4: a label is never clipped. jsdom lays nothing out, so what is held is the full name
    // in the tile and the wrapping its layout depends on, in a column allowed to shrink.
    const long =
      "Company-wide announcement banner settings for every regional storefront";
    singlesHook.mockReturnValue(
      listing([{ id: "s1", slug: "banner", label: long }])
    );
    render(<SinglesQuickLinks />);

    const name = screen.getByText(long);
    expect(name).toHaveClass("break-words");
    expect(name).not.toHaveClass("truncate");
    expect(name.parentElement).toHaveClass("min-w-0");
  });
});
