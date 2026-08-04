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
  expanded: ReadonlySet<string>,
  level = 0,
  parentId?: string
): TreeRow[] {
  const rows: TreeRow[] = [];
  nodes.forEach((node, index) => {
    const hasChildren = node.children !== undefined && node.children.length > 0;
    rows.push({
      node,
      level,
      setSize: nodes.length,
      posInSet: index,
      parentId,
      hasChildren,
    });
    if (hasChildren && expanded.has(node.id)) {
      rows.push(...flatten(node.children ?? [], expanded, level + 1, node.id));
    }
  });
  return rows;
}

/**
 * State the caller may own or may not.
 *
 * The controlled value wins when it is supplied, and the internal one is kept in step so that a
 * component switching from uncontrolled to controlled does not jump.
 */
function useControllable<T>(
  controlled: T | undefined,
  fallback: T
): [T, (next: T) => void, React.Dispatch<React.SetStateAction<T>>] {
  const [uncontrolled, setUncontrolled] = React.useState(fallback);
  const value = controlled === undefined ? uncontrolled : controlled;
  return [value, setUncontrolled, setUncontrolled];
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
  /** The selected node id, if the caller owns it. */
  selectedId?: string | null;
  /** Which id starts selected when the caller does not own selection. */
  defaultSelectedId?: string | null;
  /** Called when a row is chosen, by pointer or by Enter. */
  onSelectedChange?: (id: string) => void;
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
      defaultSelectedId,
      onSelectedChange,
      className,
      ...props
    },
    forwardedRef
  ) => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
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

    const choose = (id: string): void => {
      if (selectedId === undefined) setSelected(id);
      onSelectedChange?.(id);
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
            focusRow(step(index, 1));
          }
          return;
        case "ArrowLeft":
          event.preventDefault();
          if (row.hasChildren && expanded.has(row.node.id)) {
            setExpansion(row.node.id, false);
          } else if (row.parentId !== undefined) {
            const parent = rows.findIndex(
              candidate => candidate.node.id === row.parentId
            );
            if (parent >= 0) focusRow(parent);
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
          if (row.node.disabled !== true) choose(row.node.id);
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

    return (
      <div
        ref={scrollRef}
        className={cn("overflow-auto", className)}
        {...props}
      >
        <div
          ref={forwardedRef}
          role="tree"
          aria-label={props["aria-label"]}
          onKeyDown={onKeyDown}
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map(item => {
            const row = rows[item.index];
            if (row === undefined) return null;
            const isSelected = selected === row.node.id;
            const isActive = item.index === activeIndex;
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
                tabIndex={isActive ? 0 : -1}
                onFocus={() => setActiveId(row.node.id)}
                onClick={() => {
                  if (row.node.disabled === true) return;
                  setActiveId(row.node.id);
                  choose(row.node.id);
                }}
                className={cn(
                  "absolute left-0 flex w-full select-none items-center gap-1 rounded-sm pr-2 text-sm outline-none",
                  "focus-visible:ring-1 focus-visible:ring-ring",
                  row.node.disabled === true
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer",
                  isSelected ? "bg-muted text-foreground" : "hover:bg-muted/50"
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
