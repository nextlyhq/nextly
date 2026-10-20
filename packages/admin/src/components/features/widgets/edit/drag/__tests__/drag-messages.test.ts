/**
 * What a drag says, through the dashboard's one live region.
 *
 * Positions are counted from one, in list order, which is the order the arrow
 * keys step through, so what is heard and what a key does agree. The move
 * itself is announced by the grid's existing "moved from n to m of N".
 */
import { describe, expect, it } from "vitest";

import { DRAG_INSTRUCTIONS, dragMessages, handleLabel } from "../drag-messages";

describe("what a drag says", () => {
  it("says how to move a card picked up from the keyboard, and where it starts", () => {
    expect(dragMessages.pickedUp("Recent entries", 2, 9, "keyboard")).toBe(
      "Picked up Recent entries, position 3 of 9. Use the arrow keys to move it, Space to drop it, Escape to cancel."
    );
  });

  it("says only what was picked up when a pointer picks it up", () => {
    // The pointer user is looking at the line; the keys would be noise.
    expect(dragMessages.pickedUp("Recent entries", 2, 9, "pointer")).toBe(
      "Picked up Recent entries."
    );
  });

  it("says each new position as a key moves it, counting from one", () => {
    expect(dragMessages.position(0, 9)).toBe("Position 1 of 9.");
  });

  it("says when a drop changes nothing, and when a move is cancelled", () => {
    expect(dragMessages.droppedInPlace("Recent entries")).toBe(
      "Recent entries dropped where it was."
    );
    expect(dragMessages.cancelled()).toBe("Move cancelled. Nothing moved.");
  });

  it("says why a move ended when the dashboard narrows to one column mid-drag", () => {
    expect(dragMessages.cancelledByNarrowing()).toBe(
      "The dashboard is one column now, so the move was cancelled. Nothing moved. Use the card's menu to move it."
    );
  });
});

describe("the handle", () => {
  it("is named for what it does to which card", () => {
    expect(handleLabel("Recent entries")).toBe("Move Recent entries");
  });

  it("tells a screen reader user how to start, in the same words the keys use", () => {
    expect(DRAG_INSTRUCTIONS).toBe(
      "To pick up a card, press Space or Enter. Use the arrow keys to move it, Space to drop it, Escape to cancel."
    );
  });
});
