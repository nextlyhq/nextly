/**
 * What a drag on the dashboard says, and what its handle is called.
 *
 * The dashboard's own words rather than the shared field-array ones: those say
 * "X is over Y", which is wrong where a card lands BETWEEN cards rather than
 * on one. Positions are counted from one, in list order, which is the order
 * the arrow keys step through. The completed move is announced by the grid's
 * existing "moved from n to m of N", so it is not repeated here.
 *
 * @module components/features/widgets/edit/drag/drag-messages
 */

/** The keys, said once, so the instructions and the pick-up agree word for word. */
const KEYS =
  "Use the arrow keys to move it, Space to drop it, Escape to cancel.";

/** What the drag library reads to a screen reader user who reaches a handle. */
export const DRAG_INSTRUCTIONS = `To pick up a card, press Space or Enter. ${KEYS}`;

/** The handle's accessible name. */
export function handleLabel(title: string): string {
  return `Move ${title}`;
}

export const dragMessages = {
  /**
   * A card picked up. From the keyboard it says where the card starts and how
   * to move it; from a pointer only what was picked up, since the line shows
   * the rest.
   */
  pickedUp(
    title: string,
    from: number,
    count: number,
    by: "keyboard" | "pointer"
  ): string {
    return by === "keyboard"
      ? `Picked up ${title}, position ${from + 1} of ${count}. ${KEYS}`
      : `Picked up ${title}.`;
  },
  /** The position an arrow key moved it to. */
  position(final: number, count: number): string {
    return `Position ${final + 1} of ${count}.`;
  },
  /** A drop that changes nothing. */
  droppedInPlace(title: string): string {
    return `${title} dropped where it was.`;
  },
  /** Escape, Tab, or a cancelled pointer. */
  cancelled(): string {
    return "Move cancelled. Nothing moved.";
  },
  /**
   * The dashboard narrowed to one column mid-drag, where dragging is off. Says
   * why, and where the move is still available.
   */
  cancelledByNarrowing(): string {
    return "The dashboard is one column now, so the move was cancelled. Nothing moved. Use the card's menu to move it.";
  },
};
