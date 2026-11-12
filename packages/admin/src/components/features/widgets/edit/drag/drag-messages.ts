/**
 * What a drag on the dashboard says.
 *
 * The dashboard's own words rather than the shared field-array ones: those say
 * "X is over Y", which is wrong where a card lands BETWEEN cards rather than
 * on one. The completed move is announced by the grid's existing "moved from n
 * to m of N", so it is not repeated here.
 *
 * @module components/features/widgets/edit/drag/drag-messages
 */

export const dragMessages = {
  /** A card picked up by its handle: what was picked up, since the outline shows the rest. */
  pickedUp(title: string): string {
    return `Picked up ${title}.`;
  },
  /** A drop that changes nothing. */
  droppedInPlace(title: string): string {
    return `${title} dropped where it was.`;
  },
  /** A cancelled drag. */
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
  /**
   * The dashboard changed width mid-drag, still more than one column: the cards reflowed, so
   * the place the reader was aiming at moved. Says why; the card can be picked up again.
   */
  cancelledByResize(): string {
    return "The dashboard changed width, so the move was cancelled. Nothing moved.";
  },
};
