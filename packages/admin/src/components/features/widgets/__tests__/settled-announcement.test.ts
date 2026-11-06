/**
 * Which batch outcome a reader's own change keeps quiet: only the one that follows it.
 *
 * A change that re-asks the batch (a removal) has said what happened, so the batch coming to rest
 * whole does not speak over it. A change that asks nothing (a drag) is followed by no load at all,
 * so it keeps nothing quiet: an outcome that arrives later, such as a card appearing, is news of
 * its own and is said.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useGridAnnouncer } from "../useGridAnnouncer";

/** What the live region reads, without the invisible mark that makes a repeat re-read. */
const spoken = (announcement: string) =>
  announcement.replace(/\u200b/g, "").trim();

/** The batch as the grid hands it to the announcer. */
interface Batch {
  settling: boolean;
  counted: number;
  failed: number;
}

/** The announcer over a batch of two cards, at rest and answered. */
function announcer() {
  return renderHook(
    ({ settling, counted, failed }: Batch) =>
      useGridAnnouncer(settling, counted, failed),
    { initialProps: { settling: false, counted: 2, failed: 0 } }
  );
}

describe("the outcome a reader's own change keeps quiet", () => {
  it("is none after a drag, which asks nothing: a card appearing later is said", () => {
    const { result, rerender } = announcer();
    expect(spoken(result.current.announcement)).toBe("2 of 2 widgets updated.");

    // Dropped: the cards ask in a stable order, so the batch is not asked again.
    act(() => result.current.announceDrag("Notes dropped at 2 of 2."));
    expect(spoken(result.current.announcement)).toBe(
      "Notes dropped at 2 of 2."
    );

    // A refresh that comes to rest at the outcome already spoken: nothing new to say.
    rerender({ settling: true, counted: 2, failed: 0 });
    rerender({ settling: false, counted: 2, failed: 0 });
    expect(spoken(result.current.announcement)).toBe(
      "Notes dropped at 2 of 2."
    );

    // A card that appears on its own, which no change of the reader's asked for.
    rerender({ settling: true, counted: 3, failed: 0 });
    rerender({ settling: false, counted: 3, failed: 0 });
    expect(spoken(result.current.announcement)).toBe("3 of 3 widgets updated.");
  });

  it("is the load a removal starts: its sentence stands, and the outcome after it is said", () => {
    const { result, rerender } = announcer();
    // Removed, and the batch asked again for the cards left, in the same render.
    act(() => {
      result.current.announceRemoved("Notes");
      rerender({ settling: true, counted: 1, failed: 0 });
    });
    rerender({ settling: false, counted: 1, failed: 0 });
    expect(spoken(result.current.announcement)).toBe("Notes removed.");

    // The removal's outcome has been and gone, so the next one is the batch's own news.
    rerender({ settling: true, counted: 2, failed: 0 });
    rerender({ settling: false, counted: 2, failed: 0 });
    expect(spoken(result.current.announcement)).toBe("2 of 2 widgets updated.");
  });

  it("never includes a failure, which the change's sentence could not carry", () => {
    const { result, rerender } = announcer();
    act(() => {
      result.current.announceRemoved("Notes");
      rerender({ settling: true, counted: 1, failed: 0 });
    });
    rerender({ settling: false, counted: 1, failed: 1 });
    expect(spoken(result.current.announcement)).toBe(
      "0 of 1 widget updated, 1 failed."
    );
  });
});
