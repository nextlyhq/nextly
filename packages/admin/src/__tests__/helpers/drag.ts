/**
 * Driving a dnd-kit surface from the keyboard under jsdom, and hearing it.
 *
 * jsdom performs no layout, and dnd-kit decides what a dragged item is over
 * by measuring nodes with `getBoundingClientRect`. Every node at 0×0 makes the
 * first droppable "nearest" to everything, which is no geometry any surface
 * has — so a test lays its sortable nodes out first, and from there a Space,
 * an arrow and a Space move an item the way a keyboard user's would.
 *
 * @module __tests__/helpers/drag
 */

import { vi } from "vitest";

/**
 * Give each node the rectangle a rendered surface would give it: stacked in
 * the order given, `height` apart, full `width`. Restored by
 * `vi.restoreAllMocks()`.
 */
export function layOutStacked(
  nodes: readonly Element[],
  { height = 40, width = 600 }: { height?: number; width?: number } = {}
): void {
  nodes.forEach((node, index) => {
    const top = index * height;
    const rect = {
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: width,
      width,
      height,
      toJSON: () => ({}),
    } satisfies DOMRect;
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue(rect);
  });
}

/**
 * dnd-kit's own live region.
 *
 * Found by the id prefix dnd-kit gives it rather than by role, so a second
 * status region on the page can never satisfy an assertion about this one.
 */
export function dragRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[id^="DndLiveRegion"]');
  if (!region) throw new Error("dnd-kit rendered no live region");
  return region;
}

/**
 * Every sentence dnd-kit's live region speaks from now on, in order.
 *
 * A live region holds only its LATEST sentence, and two sentences spoken in
 * one React batch leave only the second in the DOM — so the sequence is
 * recorded as it lands rather than read at the end, and a test asserts what
 * was said instead of whichever sentence won.
 */
export function recordDragRegion(): string[] {
  const region = dragRegion();
  const heard: string[] = [];
  const observer = new MutationObserver(() => {
    const said = region.textContent ?? "";
    if (said && said !== heard[heard.length - 1]) heard.push(said);
  });
  observer.observe(region, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return heard;
}
