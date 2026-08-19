/**
 * TreeView
 *
 * A keyboard-operable, virtualized tree. The layers panel of an editor is this control: a
 * hierarchy that can hold thousands of nodes, that someone navigates with arrow keys as much as
 * with a pointer, and that has to stay responsive while they do.
 *
 * **Why virtualized, and why that decides the markup.** A document of a few thousand blocks
 * renders a few thousand rows, and the cost is not the React work — it is layout and paint on
 * every expand, scroll and selection. Only the visible window is rendered here.
 *
 * That has a consequence the accessibility notes below depend on: with only a window in the DOM,
 * the nested `role="group"` markup the tree pattern usually uses **cannot be built**, because an
 * item's children may not be rendered at all. The APG covers this exact case by allowing a FLAT
 * set of `treeitem`s that describe the hierarchy through `aria-level`, `aria-setsize` and
 * `aria-posinset` instead of through nesting. A screen reader reads depth and position from those
 * attributes, so they are not decoration — without them a virtualized tree announces itself as a
 * flat list of whatever happens to be on screen.
 *
 * **Why a headless virtualizer.** The markup above is the requirement, so anything that owns the
 * DOM is unusable. `@tanstack/react-virtual` computes offsets and renders nothing.
 *
 * **State is controllable, not controlled.** `expandedIds`/`selectedId` may be passed with their
 * `onChange` partners to drive the tree from a store — which an editor will do, since selection is
 * shared with the canvas and the inspector — or omitted entirely, in which case the tree keeps its
 * own. Requiring a store for a tree in a settings dialog would be a poor trade.
 *
 * **Design specifications**:
 * - Row height: fixed 28px (`--tree-row`), so the virtualizer needs no measurement pass
 * - Indent: 12px per level, applied as padding so the whole row stays a hit target
 * - Selection: `bg-muted`, matching the menu highlight rather than a full-contrast flip
 * - Focus: `focus-visible` ring in the focus token
 *
 * **Accessibility**:
 * - `role="tree"` with flat `role="treeitem"` children carrying `aria-level`, `aria-setsize`,
 *   `aria-posinset`, and `aria-expanded` on anything with children
 * - Roving tabindex: exactly one row is in the tab order, so Tab enters and leaves the tree once
 *   rather than walking every node
 * - Arrow keys move and expand, per the APG tree pattern: Right expands then descends, Left
 *   collapses then ascends, Home/End jump to the ends, `*` expands every sibling
 * - Typeahead focuses the next row whose label starts with what was typed
 * - Moving focus scrolls the row into view, which virtualization would otherwise prevent: a row
 *   outside the window has no element to focus
 *
 * @example
 * ```tsx
 * <TreeView
 *   nodes={layers}
 *   aria-label="Layers"
 *   selectedId={selected}
 *   onSelectedChange={setSelected}
 *   className="h-full"
 * />
 * ```
 *
 * @module
 */

"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * One node of the tree. Children are omitted or empty for a leaf.
 *
 * @experimental
 */
export interface TreeNode {
  /** Stable identity. What selection and expansion are keyed by. */
  id: string;
  /** What the row shows. A string also feeds typeahead; anything else needs `textValue`. */
  label: React.ReactNode;
  /**
   * The text typeahead matches on, when `label` is not a string.
   *
   * Without it a row rendered as markup cannot be typed to, and a keyboard user loses the fastest
   * way through a long tree.
   */
  textValue?: string;
  /** Children, if any. An empty array still marks the node as a parent. */
  children?: readonly TreeNode[];
  /** Shown before the label, after the twisty. */
  icon?: React.ReactNode;
  /** Skipped by every keyboard move and not selectable. */
  disabled?: boolean;
}

/** A node flattened into a row, carrying what the ARIA attributes need. */
interface TreeRow {
  node: TreeNode;
  /** Depth from the root, zero-based. `aria-level` is this plus one. */
  level: number;
  /** How many siblings share this position, for `aria-setsize`. */
  setSize: number;
  /** Position among those siblings, zero-based. `aria-posinset` is this plus one. */
  posInSet: number;
  /** The parent row's id, for the Left-arrow move. */
  parentId?: string;
  hasChildren: boolean;
}

const ROW_HEIGHT = 28;
const INDENT_PER_LEVEL = 12;

/** The text a row can be typed to, falling back to a string label. */
function textOf(node: TreeNode): string {
  if (typeof node.textValue === "string") return node.textValue;
  return typeof node.label === "string" ? node.label : "";
}

/**
 * The visible rows, in the order they are shown.
 *
 * Only expanded branches are walked, so a collapsed subtree of ten thousand nodes costs nothing —
 * which is the other half of why this scales, and the half virtualization does not give you.
 */
function flatten(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>
): TreeRow[] {
  const rows: TreeRow[] = [];
  // An explicit stack rather than recursion, so depth costs heap instead of call frames. A
  // document that is one long expanded chain would otherwise overflow the JavaScript stack before
  // the virtualizer ever got to window it — this control failing on the one shape virtualization
  // does not already help with.
  const pending: {
    list: readonly TreeNode[];
    index: number;
    level: number;
    parentId?: string;
  }[] = [{ list: nodes, index: 0, level: 0 }];

  while (pending.length > 0) {
    const frame = pending[pending.length - 1];
    if (frame === undefined || frame.index >= frame.list.length) {
      pending.pop();
      continue;
    }
    const node = frame.list[frame.index];
    const posInSet = frame.index;
    frame.index += 1;
    if (node === undefined) continue;
    // Any declared children array marks a branch, empty or not. A folder that is empty, or
    // whose contents have not loaded, is still something to expand — and the exported contract
    // says so, so reading length here would quietly contradict it.
    const hasChildren = node.children !== undefined;
    rows.push({
      node,
      level: frame.level,
      setSize: frame.list.length,
      posInSet,
      parentId: frame.parentId,
      hasChildren,
    });
    if (hasChildren && expanded.has(node.id)) {
      pending.push({
        list: node.children ?? [],
        index: 0,
        level: frame.level + 1,
        parentId: node.id,
      });
    }
  }
  return rows;
}

/**
 * State the caller may own, or may leave to the component.
 *
 * Which of the two it is has to be decided once and kept: a prop that starts defined and later
 * goes undefined releases control, and the internal state behind it is still at its initial
 * value, so expansion or selection jumps back to the default. Mirroring the controlled value into
 * the internal one on every render would fix the jump and cost a render loop for an array prop
 * built inline, which is the normal way to pass one.
 *
 * So switching is unsupported, the way React treats a controlled input that loses its value.
 * Being explicit about that beats a mechanism that works until the render it does not.
 */
function useControllable<T>(
  controlled: T | undefined,
  fallback: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [uncontrolled, setUncontrolled] = React.useState(fallback);
  return [
    controlled === undefined ? uncontrolled : controlled,
    setUncontrolled,
  ];
}

/**
 * Which gesture a row's modifiers meant.
 *
 * Named by the same three words the rest of the system uses, so a caller maps
 * them onto its own selection rules without translating. Both Meta and Control
 * mean toggle: a Mac author presses Command and a Windows author presses
 * Control, and neither ever presses the other's.
 *
 * Shift outranks the toggle modifier — a shift+mod click is a slip rather than
 * a fourth gesture, and extending is the one whose result is visible and undone
 * by a plain click.
 *
 * @experimental
 */
export type TreeSelectionMode = "replace" | "toggle" | "extend";

/**
 * Read the gesture from the event that carried it.
 *
 * @experimental
 */
export function treeSelectionMode(modifiers: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): TreeSelectionMode {
  if (modifiers.shiftKey) return "extend";
  if (modifiers.metaKey || modifiers.ctrlKey) return "toggle";
  return "replace";
}

/**
 * Whether a row is in the selection at all.
 *
 * A helper rather than an expression inside the render, so the multi-select
 * branch is one call there instead of a condition — a small edit to a large
 * function is what pushes it across a complexity threshold.
 *
 * `selectedIds` when the caller owns a set, the single id otherwise, so a
 * caller that has not adopted the set keeps exactly the behaviour it had.
 *
 * @experimental
 */
export function isRowSelected(
  id: string,
  primary: string | null | undefined,
  selectedIds: readonly string[] | undefined
): boolean {
  return selectedIds === undefined ? primary === id : selectedIds.includes(id);
}

/** @experimental */
export interface TreeViewProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** The roots of the tree. */
  nodes: readonly TreeNode[];
  /** Expanded node ids, if the caller owns them. */
  expandedIds?: readonly string[];
  /** Which ids start expanded when the caller does not own expansion. */
  defaultExpandedIds?: readonly string[];
  /** Called with the full next set whenever a branch opens or closes. */
  onExpandedChange?: (ids: string[]) => void;
  /**
   * The selected node id, if the caller owns it.
   *
   * With `selectedIds` also supplied this is the PRIMARY — the row a detail
   * panel answers for. Drawn at a heavier weight so a reader can tell which
   * member of a multi-row selection the rest of the screen describes.
   */
  selectedId?: string | null;
  /**
   * Every selected id, when the caller holds more than one.
   *
   * Additive: omit it and the tree behaves exactly as it did. Supplying it also
   * makes the tree announce itself as `aria-multiselectable`, which is why it
   * is a separate prop rather than inferred — a single-select tree claiming to
   * be multi-selectable is wrong in a way a screen-reader user acts on.
   */
  selectedIds?: readonly string[];
  /** Which id starts selected when the caller does not own selection. */
  defaultSelectedId?: string | null;
  /** Called when a row is chosen, by pointer or by Enter. */
  onSelectedChange?: (id: string, mode: TreeSelectionMode) => void;
  /**
   * Names the tree for a screen reader. One of this or `aria-labelledby` is required: a tree
   * announced only as "tree" tells a user nothing about which one they are in.
   */
  "aria-label"?: string;
}

/**
 * A virtualized tree.
 *
 * @experimental
 */
const TreeView = React.forwardRef<HTMLDivElement, TreeViewProps>(
  (
    {
      nodes,
      expandedIds,
      defaultExpandedIds,
      onExpandedChange,
      selectedId,
      selectedIds,
      defaultSelectedId,
      onSelectedChange,
      className,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    forwardedRef
  ) => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    // The forwarded ref goes to the SCROLL container, not to the element carrying the role. That
    // is the one a caller measures or calls `scrollTo` on; the inner element is a sized spacer
    // and scrolling it does nothing.
    const attachScroll = React.useCallback(
      (node: HTMLDivElement | null) => {
        scrollRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef !== null && forwardedRef !== undefined) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef]
    );
    const [expandedState, setExpandedState] = useControllable(
      expandedIds === undefined ? undefined : [...expandedIds],
      [...(defaultExpandedIds ?? [])]
    );
    const expanded = React.useMemo(
      () => new Set(expandedIds ?? expandedState),
      [expandedIds, expandedState]
    );
    const [selected, setSelected] = useControllable(
      selectedId === undefined ? undefined : selectedId,
      defaultSelectedId ?? null
    );

    const rows = React.useMemo(
      () => flatten(nodes, expanded),
      [nodes, expanded]
    );

    // Which row holds the tab stop. Kept as an id rather than an index so that expanding a branch
    // above it does not silently move the tab stop to a different node.
    const [activeId, setActiveId] = React.useState<string | null>(null);
    const activeIndex = Math.max(
      0,
      rows.findIndex(row => row.node.id === (activeId ?? selected))
    );

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: 8,
    });

    const commitExpanded = (next: Set<string>): void => {
      const ids = [...next];
      if (expandedIds === undefined) setExpandedState(ids);
      onExpandedChange?.(ids);
    };

    const setExpansion = (id: string, open: boolean): void => {
      const next = new Set(expanded);
      if (open) next.add(id);
      else next.delete(id);
      commitExpanded(next);
    };

    const choose = (id: string, mode: TreeSelectionMode = "replace"): void => {
      // The uncontrolled fallback tracks the PRIMARY only. A caller wanting a
      // set owns it; inventing a default set here would give an uncontrolled
      // tree a selection its caller never sees.
      if (selectedId === undefined) setSelected(id);
      onSelectedChange?.(id, mode);
    };

    /**
     * Move the tab stop, and bring the row into view.
     *
     * The scroll is not a nicety: a row outside the rendered window has no element, so focusing it
     * would do nothing at all and the arrow key would appear dead.
     */
    const focusRow = (index: number): void => {
      const row = rows[index];
      if (row === undefined) return;
      setActiveId(row.node.id);
      virtualizer.scrollToIndex(index, { align: "auto" });
      // After the scroll the row may have only just been rendered, so the element is looked up on
      // the next frame rather than now.
      requestAnimationFrame(() => {
        const element = scrollRef.current?.querySelector<HTMLElement>(
          `[data-tree-index="${index}"]`
        );
        element?.focus();
      });
    };

    /** The next row that is not disabled, in the given direction. */
    const step = (from: number, delta: number): number => {
      for (
        let index = from + delta;
        index >= 0 && index < rows.length;
        index += delta
      ) {
        if (rows[index]?.node.disabled !== true) return index;
      }
      return from;
    };

    const typeahead = React.useRef({ query: "", at: 0 });

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const index = activeIndex;
      const row = rows[index];
      if (row === undefined) return;

      /*
       * Alt belongs to the HOST, so nothing here claims it.
       *
       * The tree pattern uses bare arrows to move, Shift to extend and Ctrl to
       * toggle; Alt appears nowhere in it, which leaves the chord free for
       * whatever embeds the tree. A host that binds one — `alt+ArrowUp` to
       * reorder, say — otherwise loses it exactly where the author is most
       * likely to press it, because the switch below reads `event.key` and
       * `ArrowUp` is `ArrowUp` whatever modifiers are down. The row then takes
       * focus, calls `preventDefault`, and the host's binding never fires.
       *
       * Returning WITHOUT `preventDefault` is the whole point: the event has to
       * go on bubbling for the host to see it.
       */
      if (event.altKey) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(step(index, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          focusRow(step(index, -1));
          return;
        case "ArrowRight":
          event.preventDefault();
          // Expand first, descend second. Pressing Right twice on a closed branch opens it and
          // then enters it, which is what the pattern asks for and what people expect.
          if (row.hasChildren && !expanded.has(row.node.id)) {
            setExpansion(row.node.id, true);
          } else if (row.hasChildren) {
            // Bounded to this row's own children. `step` searches the whole flattened tree, so an
            // expanded branch that is empty — or holds only disabled rows — would send focus to
            // whatever came next in the document instead of staying put.
            for (
              let child = index + 1;
              child < rows.length && (rows[child]?.level ?? 0) > row.level;
              child += 1
            ) {
              if (
                rows[child]?.parentId === row.node.id &&
                rows[child]?.node.disabled !== true
              ) {
                focusRow(child);
                break;
              }
            }
          }
          return;
        case "ArrowLeft":
          event.preventDefault();
          if (row.hasChildren && expanded.has(row.node.id)) {
            setExpansion(row.node.id, false);
          } else if (row.parentId !== undefined) {
            // Climb past a disabled ancestor. A disabled branch can still be expanded and hold
            // enabled children, and every other keyboard move refuses to land on one — so
            // stopping here would be the single way to focus a row the rest of the control skips.
            let ancestor: string | undefined = row.parentId;
            while (ancestor !== undefined) {
              const at: number = rows.findIndex(
                candidate => candidate.node.id === ancestor
              );
              if (at < 0) break;
              if (rows[at]?.node.disabled !== true) {
                focusRow(at);
                break;
              }
              ancestor = rows[at]?.parentId;
            }
          }
          return;
        case "Home":
          event.preventDefault();
          focusRow(rows[0]?.node.disabled === true ? step(0, 1) : 0);
          return;
        case "End": {
          event.preventDefault();
          const last = rows.length - 1;
          focusRow(rows[last]?.node.disabled === true ? step(last, -1) : last);
          return;
        }
        case "Enter":
        case " ":
          event.preventDefault();
          /*
           * The same three gestures the pointer has, so multi-select is not a
           * mouse-only capability. WCAG 2.2 SC 2.1.1 asks that everything
           * reachable by pointer be reachable from a keyboard, and the APG's
           * multi-select tree pattern names Ctrl+Space for toggle and Shift for
           * extend — which is what these modifiers resolve to.
           */
          if (row.node.disabled !== true) {
            choose(row.node.id, treeSelectionMode(event));
          }
          return;
        case "*": {
          event.preventDefault();
          // Every sibling at this level, which is the pattern's shortcut for "show me this whole
          // layer" without walking it.
          const next = new Set(expanded);
          for (const sibling of rows) {
            if (sibling.parentId === row.parentId && sibling.hasChildren) {
              next.add(sibling.node.id);
            }
          }
          commitExpanded(next);
          return;
        }
        default:
          break;
      }

      // Typeahead. A single printable character extends the query rather than replacing it, so
      // typing "he" reaches "header" instead of stopping at every row beginning with "e".
      if (
        event.key.length !== 1 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      const now = Date.now();
      const state = typeahead.current;
      state.query = now - state.at > 500 ? event.key : state.query + event.key;
      state.at = now;
      const query = state.query.toLowerCase();
      for (let offset = 1; offset <= rows.length; offset += 1) {
        const candidate = rows[(index + offset) % rows.length];
        if (candidate === undefined || candidate.node.disabled === true)
          continue;
        if (textOf(candidate.node).toLowerCase().startsWith(query)) {
          focusRow(rows.indexOf(candidate));
          return;
        }
      }
    };

    // The roving tab stop has to be on a row that EXISTS and that keyboard navigation would
    // accept. Neither is guaranteed by the active index: a selection outside the first window is
    // not rendered at scrollTop 0, so every rendered row would compare false and the tree would
    // have no tab stop at all — unreachable by Tab until something else scrolled it. And a
    // disabled row is skipped by pointer and by every arrow key, so landing on it by Tab
    // contradicts the rest of the control.
    const virtualItems = virtualizer.getVirtualItems();
    const usable = (index: number): boolean =>
      rows[index]?.node.disabled !== true;
    const tabStopIndex =
      virtualItems.some(item => item.index === activeIndex) &&
      usable(activeIndex)
        ? activeIndex
        : (virtualItems.find(item => usable(item.index))?.index ?? -1);

    return (
      <div
        ref={attachScroll}
        className={cn("overflow-auto", className)}
        {...props}
      >
        <div
          role="tree"
          // The naming attributes go on the element that carries the role, not on the scroll
          // container around it. Left outside, a caller who names the tree with
          // `aria-labelledby` gets a tree with no accessible name at all — the label sits on a
          // plain div and the role element is announced as an unlabelled tree.
          // Only when the caller actually holds a set — see `selectedIds`.
          aria-multiselectable={selectedIds === undefined ? undefined : true}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          onKeyDown={onKeyDown}
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualItems.map(item => {
            const row = rows[item.index];
            if (row === undefined) return null;
            const isSelected = isRowSelected(
              row.node.id,
              selected,
              selectedIds
            );
            // Which member the rest of the screen answers for. With no set
            // supplied every selected row is the primary, so nothing changes.
            const isPrimary = selected === row.node.id;
            return (
              <div
                key={row.node.id}
                data-tree-index={item.index}
                role="treeitem"
                aria-level={row.level + 1}
                aria-setsize={row.setSize}
                aria-posinset={row.posInSet + 1}
                aria-selected={isSelected}
                aria-expanded={
                  row.hasChildren ? expanded.has(row.node.id) : undefined
                }
                aria-disabled={row.node.disabled === true ? true : undefined}
                // Roving tabindex: one row in the tab order, so Tab crosses the tree once rather
                // than stopping at every node in it.
                tabIndex={item.index === tabStopIndex ? 0 : -1}
                onFocus={() => setActiveId(row.node.id)}
                onClick={event => {
                  if (row.node.disabled === true) return;
                  setActiveId(row.node.id);
                  choose(row.node.id, treeSelectionMode(event));
                }}
                className={cn(
                  "absolute left-0 flex w-full select-none items-center gap-1 rounded-sm pr-2 text-sm outline-none",
                  "focus-visible:ring-1 focus-visible:ring-ring",
                  row.node.disabled === true
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer",
                  isSelected ? "bg-muted text-foreground" : "hover:bg-muted/50",
                  // WEIGHT, not a second colour. Every row here is selected and
                  // an action applies to all of them; what a reader needs is
                  // which one the detail panel describes, and a second colour
                  // would have to mean a second kind of selected.
                  isSelected && isPrimary && "font-medium"
                )}
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 4 + row.level * INDENT_PER_LEVEL,
                }}
              >
                <span
                  // A separate hit target from the row: opening a branch and selecting it are
                  // different intents, and collapsing a folder should not also select it.
                  aria-hidden="true"
                  className="flex size-4 shrink-0 items-center justify-center"
                  onClick={event => {
                    if (!row.hasChildren) return;
                    event.stopPropagation();
                    setExpansion(row.node.id, !expanded.has(row.node.id));
                  }}
                >
                  {row.hasChildren ? (
                    <ChevronRight
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        expanded.has(row.node.id) && "rotate-90"
                      )}
                    />
                  ) : null}
                </span>
                {row.node.icon !== undefined ? (
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    {row.node.icon}
                  </span>
                ) : null}
                <span className="truncate">{row.node.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
TreeView.displayName = "TreeView";

export { TreeView };
