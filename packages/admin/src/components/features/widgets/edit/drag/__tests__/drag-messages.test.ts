/**
 * What a drag says, through the dashboard's one live region. The move itself is announced by
 * the grid's existing "moved from n to m of N".
 */
import { describe, expect, it } from "vitest";

import { dragMessages } from "../drag-messages";

describe("what a drag says", () => {
  it("says what was picked up", () => {
    expect(dragMessages.pickedUp("Recent entries")).toBe(
      "Picked up Recent entries."
    );
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

  it("says why a move ended when the dashboard changes width mid-drag", () => {
    expect(dragMessages.cancelledByResize()).toBe(
      "The dashboard changed width, so the move was cancelled. Nothing moved."
    );
  });
});
