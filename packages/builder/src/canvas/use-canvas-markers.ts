/**
 * The walk that writes the marks on the rendered page: the selection, the
 * drag's marks, the locked, conditioned and Entry content blocks, the blocks
 * hidden on the device shown, and the forced interaction state, kept right as the rendered tree changes.
 *
 * @module use-canvas-markers
 */

import {
  PAGE_ROOT_CLASS,
  previewStateClass,
  statePropagatesToAncestors,
  STYLE_STATES,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { useEffect } from "react";

import {
  isOutermostForAddress,
  nodeAddressOf,
  ownedByCanvas,
} from "./canvas-addressing";
import {
  CONDITIONED_ATTRIBUTE,
  CONDITIONED_OWN_ATTRIBUTE,
  conditionMarkFor,
  DRAG_SOURCE_ATTRIBUTE,
  DROP_PARENT_ATTRIBUTE,
  DROP_REFUSED_ATTRIBUTE,
  ENTRY_CONTENT_ATTRIBUTE,
  outermostMarkFor,
  LOCKED_ATTRIBUTE,
  SELECTED_ATTRIBUTE,
  setFlag,
  setMark,
  type ConditionMarks,
  type LockMark,
} from "./canvas-block-marks";
import { DEVICE_HIDDEN_ATTRIBUTE } from "./canvas-device-hidden";
import type { CanvasDragState } from "./canvas-drag";
import { drawnRefusal } from "./canvas-drop-refusal";
import {
  markEntryContentInert,
  observeEntryContentInertOwnership,
} from "./canvas-entry-content-inert";
import { observeRenderedTree } from "./rendered-tree";

/**
 * Mark the selected elements on the rendered tree.
 *
 * Applied AFTER the renderer has produced them, rather than asked of
 * `PageRenderer`. Which node an editor considers current is an editor's
 * concern, and a published route renders the same document without one —
 * pushing it into the renderer's contract would put editor state in the
 * component that serves live pages.
 *
 * Ids are COMPARED in JavaScript rather than matched with a selector built from
 * one. A node id reaches this from stored data, and interpolating it into
 * `querySelector` makes any character CSS treats specially either throw or,
 * worse, match something else.
 *
 * `page` is a dependency because the rendered tree is what carries the markers:
 * a re-render replaces the elements, and an effect keyed on the selection alone
 * would leave the new tree carrying none at all.
 */
export function useCanvasMarkers(
  box: React.RefObject<HTMLElement | null>,
  marked: readonly string[],
  selectedId: string | null,
  page: React.ReactNode,
  forcedState: StyleState | undefined,
  drag: CanvasDragState | undefined,
  lockedIds: ReadonlyMap<string, LockMark>,
  conditionMarks: ConditionMarks,
  entryContentMarks: ReadonlyMap<string, string>,
  deviceHiddenMarks: ReadonlyMap<string, string>
): void {
  /*
   * The drag's three marks are read into plain ids here rather than inside the
   * walk, so the effect depends on the VALUES that change the answer instead of
   * on the drag object's identity. `useCanvasDrag` returns a fresh object on
   * every pointer move, and an effect keyed on it would re-walk the whole tree
   * per frame while writing nothing new.
   */
  const sourceId = drag?.draggingId ?? null;
  const parentId = drag?.target?.at.parentId ?? null;
  const refusedId = drawnRefusal(drag)?.parentId ?? null;
  useEffect(() => {
    const container = box.current;
    if (container === null) return;
    /*
     * NAMED and re-run rather than written straight into the effect, because
     * the dependency list is not the only thing that changes the answer.
     *
     * A block whose `render` returns a promise commits its Suspense fallback
     * first and its resolved root later. That second commit inserts the element
     * carrying the node id while changing no prop, no state and no id in this
     * list — so an effect that ran once would have marked a tree the resolved
     * block was not in yet, and would leave it unmarked until an unrelated
     * selection or document change happened to run this again. Selecting a
     * `core/collection-loop` showed exactly that: no outline and no forced
     * state, on an ordinary shipping block.
     */
    const mark = (): void => {
      /*
       * Every element a marker can land on OR currently carries one, which are
       * not the same set. A render can move a node id from one existing element
       * to another without touching the child list — the attribute case this
       * effect subscribes to — and the element that LOST the id then matches
       * nothing selected by node id. Left out, it keeps the selection attribute
       * and the state class it was last given: a second outline around a block
       * nothing is editing, and a hover appearance forced on it.
       *
       * The rendered PAGE ROOT is named explicitly rather than reached by one
       * of the marker selectors: `PageRenderer` draws `.nx-pb-page` as a child
       * of this container and the page tier compiles onto that element rather
       * than onto the canvas wrapper, so it must be markable before it has ever
       * been marked.
       */
      const touched = new Set<Element>([container]);
      // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
      // that declares its iterator, and this package compiles without one — so the
      // loop that reads more naturally does not type-check here.
      container
        .querySelectorAll(
          [
            `.${PAGE_ROOT_CLASS}`,
            `[${NODE_ID_ATTRIBUTE}]`,
            `[${SELECTED_ATTRIBUTE}]`,
            // The drag marks belong here for the reason the selection attribute
            // does, and the case is the same one: an element that LOSES its node
            // id matches nothing selected by node id, so leaving these out
            // strands whatever they were last given. A block that stopped being
            // the drag source would stay dimmed with nothing left to clear it.
            `[${DRAG_SOURCE_ATTRIBUTE}]`,
            `[${DROP_PARENT_ATTRIBUTE}]`,
            `[${DROP_REFUSED_ATTRIBUTE}]`,
            `[${LOCKED_ATTRIBUTE}]`,
            `[${CONDITIONED_ATTRIBUTE}]`,
            `[${CONDITIONED_OWN_ATTRIBUTE}]`,
            `[${ENTRY_CONTENT_ATTRIBUTE}]`,
            `[${DEVICE_HIDDEN_ATTRIBUTE}]`,
            ...STYLE_STATES.map(state => `.${previewStateClass(state)}`),
          ].join(", ")
        )
        .forEach(element => touched.add(element));

      touched.forEach(element => {
        // Another canvas's elements are that canvas's to mark, exactly as the
        // drag pass below leaves them. Ids are scoped per document, so a nested
        // canvas can hold an instance with the SAME address as the one selected
        // out here — and marking it would outline a block belonging to a
        // document this selection is not in.
        if (!ownedByCanvas(element, container)) return;
        // The ADDRESS, not the raw attribute. A definition-owned element
        // carries a re-minted id the selection never holds, so comparing the
        // attribute leaves a selected component with no outline at all.
        const id = nodeAddressOf(element);
        // OUTERMOST only, which draws one outline per instance while still
        // marking every copy of a node a block rendered more than once — see
        // `isOutermostForAddress` for why those two cases need opposite
        // answers.
        if (
          id === null ||
          !marked.includes(id) ||
          !isOutermostForAddress(element, id, container)
        ) {
          // Guarded like the writes below: this walk now visits the page root
          // and the container, which never carry the attribute, and removing an
          // absent one still touches the element.
          if (element.hasAttribute(SELECTED_ATTRIBUTE)) {
            element.removeAttribute(SELECTED_ATTRIBUTE);
          }
          return;
        }
        // The VALUE carries which member the panels answer for. A boolean
        // attribute could not, and a second attribute for the primary would be a
        // state where a block is primary without being selected.
        //
        // Compared before writing, for the reason the class below is: this walk
        // re-runs on every change to the rendered tree, and `setAttribute`
        // queues a mutation record even when the value it writes is the value
        // already there. Unguarded, marking a tree that did not change is
        // itself a change — the spacing overlay observes this subtree and
        // re-measures on one, so its own output would arrive back here as a
        // reason to write again.
        const value = id === selectedId ? "primary" : "";
        if (element.getAttribute(SELECTED_ATTRIBUTE) !== value) {
          element.setAttribute(SELECTED_ATTRIBUTE, value);
        }
      });

      /*
       * The drag's marks, in the SAME walk and over the SAME set, for the
       * reason the forced state below is: all of them answer "what is marked on
       * this element right now", and two walks over one question drift — one
       * runs on a change the other does not.
       *
       * Over `touched` rather than a fresh query, so an element that has just
       * LOST the node id is visited and cleared. Left out, a block that stopped
       * being the drag source keeps the mark and stays dimmed after the drop.
       */
      const dragMarks: ReadonlyArray<readonly [string, string | null]> = [
        [DRAG_SOURCE_ATTRIBUTE, sourceId],
        [DROP_PARENT_ATTRIBUTE, parentId],
        [DROP_REFUSED_ATTRIBUTE, refusedId],
      ];
      touched.forEach(element => {
        if (!ownedByCanvas(element, container)) return;
        const id = element.getAttribute(NODE_ID_ATTRIBUTE);
        // Whether the engine would refuse to move this node, asked from the set
        // rather than from the document per element: this walk re-runs on every
        // change to the rendered tree, and a tree search per element would make
        // that quadratic on a large page. Asked by the ADDRESS, as the selection
        // pass above is: a placement's parts carry a re-minted id the document
        // does not hold, and the lock that holds them is the placement's.
        const address = nodeAddressOf(element);
        setMark(
          element,
          LOCKED_ATTRIBUTE,
          address === null ? undefined : lockedIds.get(address)
        );
        // On the block's own outermost element, so a block a list draws once
        // per entry is marked once per copy and its parts are not marked again.
        const condition = conditionMarkFor(element, container, conditionMarks);
        setMark(element, CONDITIONED_ATTRIBUTE, condition?.mark);
        setMark(
          element,
          CONDITIONED_OWN_ATTRIBUTE,
          condition?.own === true ? (condition.nested ?? "") : undefined
        );
        // An Entry content block's words, on its outermost element alike.
        setMark(
          element,
          ENTRY_CONTENT_ATTRIBUTE,
          outermostMarkFor(element, container, entryContentMarks)
        );
        // A block hidden on the device shown, striped with its tag, alike.
        setMark(
          element,
          DEVICE_HIDDEN_ATTRIBUTE,
          outermostMarkFor(element, container, deviceHiddenMarks)
        );
        for (const [attribute, wanted] of dragMarks) {
          setFlag(element, attribute, id !== null && id === wanted);
        }
      });

      /*
       * The forced interaction state, in the SAME walk rather than a second one.
       * Both answer "what is marked on this element right now", and two walks
       * over one question drift — one runs on a change the other does not.
       *
       * On the PRIMARY alone. A page cannot force a pseudo-class on itself, so
       * the compiler emits a class alternative beside each one and this puts it
       * on the element the panel is editing. Forcing it page-wide would show
       * every other block in a state nobody asked about.
       *
       * Cleared from everything first, including the primary: a state that
       * changes from hover to focus, or a selection that moves, must not leave
       * the previous class behind on an element nothing is editing.
       */
      /*
       * WHICH ELEMENTS a forced state belongs on, ASKED of the engine rather
       * than decided here.
       *
       * Whether a state propagates follows from the pseudo-class the compiler
       * emits for it — an ancestor matches `:hover` and `:active` and does not
       * match `:focus-visible` — so the two facts live together beside that
       * definition. Encoding the rule here as well would be a second opinion
       * about the CSS: changing `focus` to `:focus-within` would move the
       * published rules and leave this canvas marking the wrong chain, with both
       * sides type-correct.
       *
       * Where a state does propagate the chain is required rather than tidy: the
       * page tier compiles onto the RENDERED page root, and a marker on a
       * descendant cannot make its ancestor match.
       */
      const chain = new Set<Element>();
      if (forcedState !== undefined && forcedState !== "base") {
        /*
         * EVERY rendering of the primary node, not the first one found.
         *
         * A node id is unique in a DOCUMENT and not in the tree drawn from it:
         * `core/collection-loop` draws its children once per entry, so one
         * selected node is many elements, and the walk above has already marked
         * all of them primary. Taking `querySelector` here would preview the
         * state on whichever copy came first in DOM order — the outline on ten
         * rows and the hover appearance on one, which reads as the state being
         * broken rather than as the preview being partial.
         */
        container
          .querySelectorAll(`[${SELECTED_ATTRIBUTE}="primary"]`)
          .forEach(primary => {
            chain.add(primary);
            if (!statePropagatesToAncestors(forcedState)) return;
            for (
              let node: Element | null = primary.parentElement;
              node !== null && container.contains(node);
              node = node.parentElement
            ) {
              chain.add(node);
            }
          });
      }

      // The SAME set the selection was written from, so the two markers cannot
      // disagree about which elements exist.
      const marks: Element[] = Array.from(touched);

      marks.forEach(element => {
        // `base` is not a state anything forces: it is what applies when nothing
        // else does, and the compiler emits no marker for it.
        const wanted =
          chain.has(element) && forcedState !== undefined
            ? previewStateClass(forcedState)
            : undefined;

        /*
         * WRITTEN ONLY WHEN IT CHANGES, which is not a micro-optimisation.
         *
         * `classList.remove` of a token that is not present still touches the
         * attribute, and this canvas is observed: the empty-container appender
         * watches its subtree for layout-relevant mutations and re-measures on
         * one. An unconditional clear across every marked element therefore made
         * every selection change schedule a re-measure of the whole overlay,
         * which its own test caught — it asserts the control does NOT move for a
         * mutation of its own output, and it moved.
         */
        for (const state of STYLE_STATES) {
          const marker = previewStateClass(state);
          if (marker !== wanted && element.classList.contains(marker)) {
            element.classList.remove(marker);
          }
        }
        if (wanted !== undefined && !element.classList.contains(wanted)) {
          element.classList.add(wanted);
        }
      });
      // The entry's blocks drawn in Entry content: looked at, never used.
      markEntryContentInert(container);
    };

    // Before the first pass, so a block's change to an element's inert after
    // the pass marks it is seen; it writes only `inert` and the inert mark,
    // neither of which counts as the tree changing.
    const stopOwnership = observeEntryContentInertOwnership(container);
    mark();
    // Subscribed AFTER the first pass, because an observer reports what changes
    // from the moment it attaches and says nothing about the tree already
    // there. Writing the markers cannot re-enter this: what counts as the tree
    // changing excludes every attribute `mark` writes.
    const stopTree = observeRenderedTree(container, mark);
    return () => {
      stopTree();
      stopOwnership();
    };
  }, [
    box,
    selectedId,
    marked,
    page,
    forcedState,
    sourceId,
    parentId,
    refusedId,
    lockedIds,
    conditionMarks,
    entryContentMarks,
    deviceHiddenMarks,
  ]);
}
