"use client";

/**
 * The Builder's outline: every field of the entity, at every depth, as one
 * indented tree, beside the settings panel.
 *
 * It draws what `outline-model` decides (which rows exist, which are
 * read-only, which show) and owns only what a person does to the view: what
 * is folded (remembered for this entity in this browser), what is being
 * looked for, which row has focus, and which row's menu is open. What a field
 * is and what changes it belong to the page, through `callbacks`.
 *
 * It is a tree to assistive technology, with the tree's keys: Up and Down
 * move, Right unfolds or enters, Left folds or leaves, Home and End, and
 * type-ahead. Enter opens the panel; Shift+F10 or the context-menu key opens
 * the row's menu; Alt+Up and Alt+Down move a field within its container.
 */
import {
  SortableContext,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { Button, Input } from "@nextlyhq/ui";
import type { JSX, KeyboardEvent, ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { usePersistedStringSet } from "@admin/hooks/usePersistedState";
import type { BuilderFieldError } from "@admin/lib/builder/field-validators";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import {
  containerPaths,
  flattenOutline,
  visibleRows,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import type { BuilderKind } from "../builder-config";
import { EmptyState } from "../builder-field-list/EmptyState";
import type { BuilderField } from "../types";

import { AddPlace, withAddPlaces } from "./AddPlace";
import { OutlineRow } from "./OutlineRow";
import type { OutlineActions } from "./OutlineRowMenu";
import { SystemFieldsContainer } from "./SystemFieldsContainer";
import { useFieldTypeLabel } from "./useFieldTypeLabel";

/** What the outline asks of the page. */
export interface OutlineCallbacks {
  select: (id: string) => void;
  /** Open the picker for a new field at `position`. */
  addAt: (position: FieldInsertPosition) => void;
  move: (id: string, delta: -1 | 1) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  openFieldGroup: (slug: string) => void;
}

type Props = {
  kind: BuilderKind;
  nodes: readonly OutlineNode[];
  /** The entity's built-in fields, shown above the outline. */
  systemFields: readonly BuilderField[];
  errors: ReadonlyMap<string, BuilderFieldError>;
  /** Where this entity's fold state is remembered, in this browser. */
  foldKey: string;
  selectedId: string | null;
  /** A read-only entity: nothing is added. */
  readOnly: boolean;
  callbacks: OutlineCallbacks;
  /** The entry form as editors see it, drawn while the preview is on. */
  renderPreview: () => ReactNode;
};

/** How long type-ahead keeps adding to what was typed, in milliseconds. */
const TYPE_AHEAD_MS = 600;

/** The id of the row an event happened on, if it happened on a row itself. */
function rowIdOf(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.getAttribute("role") !== "treeitem") return null;
  return target.id.startsWith(ROW_ID_PREFIX)
    ? target.id.slice(ROW_ID_PREFIX.length)
    : null;
}

/** What a row's element id starts with; the rest is the field's id. */
const ROW_ID_PREFIX = "outline-row-";

export function Outline({
  kind,
  nodes,
  systemFields,
  errors,
  foldKey,
  selectedId,
  readOnly,
  callbacks,
  renderPreview,
}: Props): JSX.Element {
  const typeLabel = useFieldTypeLabel();
  const [folded, setFolded] = usePersistedStringSet(foldKey);
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const rows = useMemo(
    () => visibleRows(nodes, folded, query, typeLabel),
    [nodes, folded, query, typeLabel]
  );
  const byId = useMemo(
    () => new Map(flattenOutline(nodes).map(node => [node.id, node])),
    [nodes]
  );

  // The latest of everything the stable actions read, so one actions object
  // serves every row for the outline's whole life and no row redraws for it.
  const latest = useRef({ byId, nodes, callbacks });
  latest.current = { byId, nodes, callbacks };
  const rowElements = useRef(new Map<string, HTMLElement>());

  const registerRow = useCallback((id: string, element: HTMLElement | null) => {
    if (element) rowElements.current.set(id, element);
    else rowElements.current.delete(id);
  }, []);

  /** The siblings a node is placed among, outermost list for a top-level field. */
  const siblingsOf = useCallback((node: OutlineNode): OutlineNode[] => {
    const { byId: index, nodes: top } = latest.current;
    const parent = node.parentId ? index.get(node.parentId) : undefined;
    return parent ? parent.children : [...top];
  }, []);

  const canMove = useCallback(
    (id: string, delta: -1 | 1): boolean => {
      const node = latest.current.byId.get(id);
      if (!node || !node.own || node.readOnly) return false;
      const siblings = siblingsOf(node);
      const target = siblings[siblings.indexOf(node) + delta];
      return target !== undefined && target.own;
    },
    [siblingsOf]
  );

  /**
   * The place right after a field, in its own container: before its next
   * sibling, or at the container's end.
   */
  const positionAfter = useCallback(
    (id: string): FieldInsertPosition | null => {
      const node = latest.current.byId.get(id);
      if (!node) return null;
      const siblings = siblingsOf(node);
      const next = siblings[siblings.indexOf(node) + 1];
      return {
        ...(node.parentId ? { parentFieldId: node.parentId } : {}),
        ...(next ? { beforeFieldId: next.id } : {}),
      };
    },
    [siblingsOf]
  );

  const addAfter = useCallback(
    (id: string) => {
      const position = positionAfter(id);
      if (position) latest.current.callbacks.addAt(position);
    },
    [positionAfter]
  );

  const focusRow = useCallback((id: string, scroll = false) => {
    setFocusedId(id);
    rowElements.current.get(id)?.focus({ preventScroll: !scroll });
  }, []);

  const move = useCallback(
    (id: string, delta: -1 | 1) => {
      if (!canMove(id, delta)) return;
      const node = latest.current.byId.get(id);
      if (!node) return;
      const siblings = siblingsOf(node);
      const at = siblings.indexOf(node) + delta;
      latest.current.callbacks.move(id, delta);
      setAnnouncement(
        `Moved ${node.field.label || node.field.name || "the field"} ${
          delta < 0 ? "up" : "down"
        }, position ${at + 1} of ${siblings.length}.`
      );
    },
    [canMove, siblingsOf]
  );

  const actions = useMemo<OutlineActions>(
    () => ({
      setMenuOpen: setMenuFor,
      focusRow: id => focusRow(id),
      select: id => {
        latest.current.callbacks.select(id);
        focusRow(id);
      },
      addInside: id => latest.current.callbacks.addAt({ parentFieldId: id }),
      addAfter,
      canMove,
      move,
      duplicate: id => latest.current.callbacks.duplicate(id),
      remove: id => latest.current.callbacks.remove(id),
      setHidden: (id, hidden) => latest.current.callbacks.setHidden(id, hidden),
      openFieldGroup: slug => latest.current.callbacks.openFieldGroup(slug),
    }),
    [addAfter, canMove, focusRow, move]
  );

  const toggle = useCallback(
    (path: string) =>
      setFolded(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [setFolded]
  );

  const select = useCallback((id: string) => actions.select(id), [actions]);

  // The tab stop: the focused row while it is drawn, else the selected row,
  // else the first.
  const tabStopId =
    (focusedId && rows.some(row => row.node.id === focusedId) && focusedId) ||
    (selectedId &&
      rows.some(row => row.node.id === selectedId) &&
      selectedId) ||
    rows[0]?.node.id ||
    null;

  const typed = useRef({ text: "", at: 0 });

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The row the key was pressed on: the focused tree item, wherever focus
    // came from (a click, a key, or a script), not only where the tab stop
    // was last put.
    const id = rowIdOf(event.target);
    if (id === null) return;
    const index = rows.findIndex(row => row.node.id === id);
    const row = rows[index];
    if (!row) return;
    const go = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (target) focusRow(target.node.id, true);
    };
    const { key } = event;

    if (event.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      move(row.node.id, key === "ArrowUp" ? -1 : 1);
      return;
    }
    if ((event.shiftKey && key === "F10") || key === "ContextMenu") {
      event.preventDefault();
      setMenuFor(row.node.id);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        go(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        go(index - 1);
        return;
      case "Home":
        event.preventDefault();
        go(0);
        return;
      case "End":
        event.preventDefault();
        go(rows.length - 1);
        return;
      case "ArrowRight":
        event.preventDefault();
        if (row.expanded === false) toggle(row.node.path);
        else if (row.expanded === true) go(index + 1);
        return;
      case "ArrowLeft": {
        event.preventDefault();
        if (row.expanded === true) toggle(row.node.path);
        else if (row.node.parentId) focusRow(row.node.parentId, true);
        return;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        select(row.node.id);
        return;
      case "/":
        // "/" adds a field right after this one, in its own container. A
        // read-only row, or one in a read-only container, offers no place.
        event.preventDefault();
        if (row.node.own && row.node.readOnly === null) {
          addAfter(row.node.id);
        }
        return;
      default:
        break;
    }

    // Type-ahead: the next row whose label starts with what was typed.
    if (key.length === 1 && key !== "/" && key !== " ") {
      const now = Date.now();
      const text =
        now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + key : key;
      typed.current = { text, at: now };
      const lower = text.toLowerCase();
      const order = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
      const start = text.length > 1 ? [row, ...order] : order;
      const found = start.find(candidate =>
        (candidate.node.field.label || candidate.node.field.name)
          .toLowerCase()
          .startsWith(lower)
      );
      if (found) focusRow(found.node.id, true);
    }
  };

  // While dragging, only rows in the dragged row's own container make way:
  // a field moves within its container, and nowhere else.
  const sortableIds = useMemo(() => rows.map(row => row.node.id), [rows]);
  const strategy = useMemo<SortingStrategy>(() => {
    const parentOf = (i: number) => rows[i]?.node.parentId ?? null;
    return args =>
      parentOf(args.index) === parentOf(args.activeIndex) &&
      parentOf(args.overIndex) === parentOf(args.activeIndex)
        ? verticalListSortingStrategy(args)
        : null;
  }, [rows]);

  const finding = query.trim() !== "";

  return (
    <div className="space-y-4 p-4">
      <SystemFieldsContainer systemFields={systemFields} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Find a field"
          placeholder="Find a field by label, name or type"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape") setQuery("");
          }}
          className="h-9 max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFolded(() => new Set(containerPaths(nodes)))}
        >
          Fold all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFolded(() => new Set())}
        >
          Unfold all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={preview}
          onClick={() => setPreview(on => !on)}
          className="ml-auto"
        >
          {preview ? "Show the outline" : "Preview the form"}
        </Button>
      </div>

      {preview ? (
        <section aria-label="What editors see">{renderPreview()}</section>
      ) : nodes.length === 0 ? (
        <EmptyState
          kind={kind}
          onAdd={() => callbacks.addAt({})}
          readOnly={readOnly}
        />
      ) : (
        <>
          {finding && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No field matches “{query.trim()}”.
            </p>
          )}
          <SortableContext items={sortableIds} strategy={strategy}>
            <div
              role="tree"
              aria-label="Fields"
              onKeyDown={onTreeKeyDown}
              // The tab stop follows focus, so Tab back into the tree lands
              // on the row last focused, however it was reached.
              onFocus={event => {
                const id = rowIdOf(event.target);
                if (id !== null) setFocusedId(id);
              }}
              className="space-y-0.5"
            >
              {withAddPlaces(rows, !readOnly && !finding).map(item =>
                item.kind === "row" ? (
                  <OutlineRow
                    key={item.row.node.id}
                    row={item.row}
                    typeName={typeLabel(item.row.node.field.type)}
                    error={errors.get(item.row.node.id)?.message}
                    selected={item.row.node.id === selectedId}
                    tabStop={item.row.node.id === tabStopId}
                    draggable={
                      !finding &&
                      item.row.node.own &&
                      item.row.node.readOnly === null
                    }
                    onSelect={select}
                    onToggle={toggle}
                    registerRow={registerRow}
                    menuOpen={menuFor === item.row.node.id}
                    actions={actions}
                  />
                ) : (
                  <AddPlace
                    key={item.key}
                    place={item}
                    onAdd={place =>
                      callbacks.addAt(
                        place.kind === "before"
                          ? {
                              ...(place.parentId
                                ? { parentFieldId: place.parentId }
                                : {}),
                              beforeFieldId: place.id,
                            }
                          : { parentFieldId: place.id }
                      )
                    }
                  />
                )
              )}
            </div>
          </SortableContext>
          {!readOnly && (
            <div className="rounded-md border border-dashed border-border p-6 text-center">
              <Button onClick={() => callbacks.addAt({})}>+ Add field</Button>
            </div>
          )}
        </>
      )}

      {/* Mounted from the start, so a screen reader is already watching it
          when a move is announced. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
