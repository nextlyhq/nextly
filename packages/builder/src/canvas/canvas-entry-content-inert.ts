/**
 * The entry's own blocks an Entry content block draws on the canvas, made
 * inert so nothing inside them takes focus or a press, and given back only
 * the inert the canvas added, never one a block set itself.
 *
 * @module canvas-entry-content-inert
 */

import { ENTRY_CONTENT_DRAWN_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { ownedByCanvas } from "./canvas-addressing";
import { setMark } from "./canvas-block-marks";

/**
 * Marks the drawn element of each of the entry's own blocks this canvas draws
 * in Entry content as ours to make `inert`. Its value says whether the `inert`
 * is ours to give back ({@link INERT_ADDED}) or was the block's own before the
 * canvas marked it ({@link INERT_KEPT}).
 */
export const ENTRY_CONTENT_INERT_ATTRIBUTE = "data-nx-entry-content-inert";

/** The canvas made the element inert, and takes that back when it leaves. */
const INERT_ADDED = "added";

/** The element was inert already, by its own block, and stays so. */
const INERT_KEPT = "kept";

/**
 * Each canvas's observer of who owns its marked elements' `inert`, by
 * container, so a marking pass reads what it has not delivered yet first.
 */
const inertOwnership = new WeakMap<HTMLElement, MutationObserver>();

/**
 * Watch whose `inert` each element marked in Entry content holds, as its block
 * changes its own after the canvas marked it. Returns the unsubscribe.
 *
 * A block that starts rendering inert on an element the canvas already made
 * inert changes nothing the tree shows, so only the mutation tells: React's
 * `setAttribute` on a present attribute still queues a record, with the old
 * value. The canvas writes `inert` only where it is absent, so a record with an
 * old value that leaves the attribute present is the block's write, and the
 * element's inert is now its own. One that leaves it absent is the block
 * dropping its inert, and the canvas holds the element inert in its place.
 */
export function observeEntryContentInertOwnership(
  container: HTMLElement
): () => void {
  // From the container's own window, as the rendered tree's observer is.
  const Mutations = container.ownerDocument.defaultView?.MutationObserver;
  if (typeof Mutations !== "function") return () => undefined;
  const observer = new Mutations(records =>
    readInertOwnership(container, records)
  );
  observer.observe(container, {
    attributes: true,
    attributeFilter: ["inert"],
    attributeOldValue: true,
    subtree: true,
  });
  inertOwnership.set(container, observer);
  return () => {
    readInertOwnership(container, observer.takeRecords());
    observer.disconnect();
    if (inertOwnership.get(container) === observer) {
      inertOwnership.delete(container);
    }
  };
}

function readInertOwnership(
  container: HTMLElement,
  records: readonly MutationRecord[]
): void {
  const marked = new Set<Element>();
  records.forEach((record, index) => {
    // An attribute record's target is always an element.
    const element = record.target as Element;
    if (
      !element.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE) ||
      !ownedByCanvas(element, container)
    ) {
      return;
    }
    marked.add(element);
    // Absent before: an add, which is how the canvas writes it.
    if (record.oldValue === null) return;
    // What this write left: the next record's old value, or the tree now.
    const next = records
      .slice(index + 1)
      .find(later => later.target === element);
    const present =
      next === undefined
        ? element.hasAttribute("inert")
        : next.oldValue !== null;
    if (present) setMark(element, ENTRY_CONTENT_INERT_ATTRIBUTE, INERT_KEPT);
  });
  marked.forEach(holdEntryContentInert);
}

/**
 * Make a marked element inert where it is not. Not inert now, the inert it
 * gets is the canvas's to give back, also where its block had one and dropped
 * it: left `kept`, it would stay inert once no longer drawn in Entry content.
 */
function holdEntryContentInert(element: Element): void {
  if (element.hasAttribute("inert")) return;
  setMark(element, ENTRY_CONTENT_INERT_ATTRIBUTE, INERT_ADDED);
  element.setAttribute("inert", "");
}

/**
 * Make the entry's blocks an Entry content block draws on this canvas inert,
 * and nothing else: each child of a drawn wrapper, so no link, field or button
 * inside takes focus, a caret or a press, while the wrapper, the block's own
 * element, stays the one a click lands on and selects. The page's markup is
 * not changed, so the canvas lays the blocks out as the published page does.
 * An element no longer drawn there gives back the inert this set, and only
 * that: one a block rendered inert itself (a custom block whose root is inert)
 * keeps its `inert` when it leaves, as the canvas frame keeps a site's own.
 * Written only where it changes, as every mark here is.
 */
export function markEntryContentInert(container: HTMLElement): void {
  // A block's write to its inert this commit, before this pass gives any back.
  const pending = inertOwnership.get(container);
  if (pending !== undefined) {
    readInertOwnership(container, pending.takeRecords());
  }
  const wanted = new Set<Element>();
  container
    .querySelectorAll(`[${ENTRY_CONTENT_DRAWN_ATTRIBUTE}]`)
    .forEach(wrapper => {
      if (!ownedByCanvas(wrapper, container)) return;
      for (const child of Array.from(wrapper.children)) wanted.add(child);
    });
  container
    .querySelectorAll(`[${ENTRY_CONTENT_INERT_ATTRIBUTE}]`)
    .forEach(element => {
      // Another canvas's marks are that canvas's to clear, as they were its
      // to set: a canvas drawn inside this one (a component's own view) keeps
      // its entry's blocks inert whatever this one re-marks.
      if (wanted.has(element) || !ownedByCanvas(element, container)) return;
      const ours =
        element.getAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE) !== INERT_KEPT;
      element.removeAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE);
      if (ours) element.removeAttribute("inert");
    });
  wanted.forEach(element => {
    // Whether the inert was the block's own is read when the canvas first
    // marks the element, before it adds any; after that, its block changing
    // it is read by `observeEntryContentInertOwnership` and the hold below.
    if (!element.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)) {
      element.setAttribute(
        ENTRY_CONTENT_INERT_ATTRIBUTE,
        element.hasAttribute("inert") ? INERT_KEPT : INERT_ADDED
      );
    }
    holdEntryContentInert(element);
  });
}
