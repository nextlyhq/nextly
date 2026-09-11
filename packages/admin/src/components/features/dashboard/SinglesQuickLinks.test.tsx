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
  items: Array<{ id: string; slug: string; label?: string }>,
  extra: { isLoading?: boolean; error?: Error } = {}
): ReturnType<typeof useSingles> {
  return {
    data: { items, meta: { total: items.length } },
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
    // back. The section is queried by its accessible name, which is what the
    // grid placement is drawn around.
    singlesHook.mockReturnValue(listing([]));
    render(<SinglesQuickLinks />);

    expect(screen.getByRole("region", { name: "Singles" })).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: "Singles" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
