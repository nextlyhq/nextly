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
 * It is a tree to assistive technology, with the tree's keys (`tree-keys`).
 * A field moves by key, by its menu (Move up, Move down, Move to…) and by
 * drag, each judged by the one move rule and announced in its live region,
 * with focus kept on the field.
 */
import { Button } from "@nextlyhq/ui";
import type { FocusEvent, JSX, ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { usePersistedStringSet } from "@admin/hooks/usePersistedState";
import type { BuilderFieldError } from "@admin/lib/builder/field-validators";
import {
  containerPaths,
  flattenOutline,
  visibleRows,
  type OutlineNode,
  type VisibleRow,
} from "@admin/lib/builder/outline/outline-model";

import type { BuilderKind } from "../builder-config";
import { EmptyState } from "../builder-field-list/EmptyState";
import type { BuilderField } from "../types";

import { MoveToDialog } from "./MoveToDialog";
import type { OutlineCallbacks } from "./outline-types";
import { OutlineToolbar } from "./OutlineToolbar";
import { OutlineTree } from "./OutlineTree";
import { SystemFieldsContainer } from "./SystemFieldsContainer";
import { useFieldTypeLabel } from "./useFieldTypeLabel";
import { useOutlineActions, type OutlineActionState } from "./useOutlineActions";
import { useOutlineDrag } from "./useOutlineDrag";
import { rowIdOf, useTreeKeyDown } from "./useTreeKeyDown";

export type { OutlineCallbacks } from "./outline-types";

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

/** The tab stop: the focused row while drawn, else the selected row, else the first. */
function tabStopOf(
  rows: readonly VisibleRow[],
  focusedId: string | null,
  selectedId: string | null
): string | null {
  const drawn = (id: string | null) =>
    id !== null && rows.some(row => row.node.id === id) ? id : null;
  return drawn(focusedId) ?? drawn(selectedId) ?? rows[0]?.node.id ?? null;
}

/** The paths of a row's containers, outermost first. */
function ancestorPaths(nodes: readonly OutlineNode[], id: string): string[] {
  const byId = new Map(flattenOutline(nodes).map(node => [node.id, node]));
  const paths: string[] = [];
  let at = byId.get(id);
  while (at?.parentId) {
    at = byId.get(at.parentId);
    if (at) paths.unshift(at.path);
  }
  return paths;
}

/**
 * Focus back on a field a move asked for, once its row is drawn: unfolding
 * the containers it went into when they are folded, so the field it moved is
 * never left out of sight; dropped when nothing hides it but a find.
 */
function useRefocusAfterMove(
  state: OutlineActionState,
  rows: readonly VisibleRow[],
  nodes: readonly OutlineNode[],
  folded: ReadonlySet<string>,
  setFolded: (update: (prev: Set<string>) => Set<string>) => void
): void {
  useEffect(() => {
    const drawn = (id: string) => rows.some(row => row.node.id === id);
    const id = state.takeRefocus(drawn);
    if (id === null) return;
    if (drawn(id)) {
      state.focusRow(id, true);
      return;
    }
    const closed = ancestorPaths(nodes, id).filter(path => folded.has(path));
    if (closed.length === 0) {
      state.takeRefocus(() => true);
      return;
    }
    setFolded(prev => {
      const next = new Set(prev);
      for (const path of closed) next.delete(path);
      return next;
    });
  });
}

/** Folding one container, remembered with the rest of the entity's. */
function useFolding(foldKey: string) {
  const [folded, setFolded] = usePersistedStringSet(foldKey);
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
  return { folded, setFolded, toggle };
}

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
  const { folded, setFolded, toggle } = useFolding(foldKey);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const state = useOutlineActions(nodes, callbacks);
  const refusedHere = useOutlineDrag(state.actions);
  const movesId = useId();

  const rows = useMemo(
    () => visibleRows(nodes, folded, query, typeLabel),
    [nodes, folded, query, typeLabel]
  );
  const finding = query.trim() !== "";
  useRefocusAfterMove(state, rows, nodes, folded, setFolded);
  const onKeyDown = useTreeKeyDown({
    rows,
    actions: state.actions,
    focusRow: state.focusRow,
    toggle,
  });
  // The tab stop follows focus, so Tab back into the tree lands on the row
  // last focused, however it was reached.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const id = rowIdOf(event.target);
    if (id !== null) state.setFocusedId(id);
  };

  const tree = (
    <OutlineTree
      rows={rows}
      addable={!readOnly && !finding}
      finding={finding}
      typeLabel={typeLabel}
      errors={errors}
      selectedId={selectedId}
      tabStopId={tabStopOf(rows, state.focusedId, selectedId)}
      menuFor={state.menuFor}
      actions={state.actions}
      registerRow={state.registerRow}
      onToggle={toggle}
      onAddAt={callbacks.addAt}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      movesDescribedBy={movesId}
    />
  );

  return (
    <div className="space-y-4 p-4">
      <SystemFieldsContainer systemFields={systemFields} />
      <OutlineToolbar
        query={query}
        onQueryChange={setQuery}
        onFoldAll={() => setFolded(() => new Set(containerPaths(nodes)))}
        onUnfoldAll={() => setFolded(() => new Set())}
        preview={preview}
        onPreviewChange={setPreview}
      />
      <OutlineBody
        kind={kind}
        preview={preview}
        renderPreview={renderPreview}
        empty={nodes.length === 0}
        noMatch={finding && rows.length === 0 ? query.trim() : null}
        readOnly={readOnly}
        onAddAtEnd={() => callbacks.addAt({})}
        tree={tree}
      />
      {refusedHere && (
        <p className="text-sm text-destructive">{refusedHere}</p>
      )}
      <p id={movesId} hidden>
        Alt+Up and Alt+Down move the field; Alt+Left moves it out of its
        container, Alt+Right into the container above it. Shift+F10 opens its
        actions, Move to… among them.
      </p>
      {state.moveToFor !== null && (
        <MoveToDialog
          fieldId={state.moveToFor}
          fields={callbacks.fields}
          actions={state.actions}
          onClose={state.closeMoveTo}
        />
      )}
      {/* Mounted from the start, so a screen reader is already watching it
          when a move is announced. */}
      <div aria-live="polite" className="sr-only">
        {state.announcement}
      </div>
    </div>
  );
}

/**
 * What the outline's place holds: the form preview while it is on; the empty
 * state when there is no field; otherwise the tree, and the add at its end.
 */
function OutlineBody({
  kind,
  preview,
  renderPreview,
  empty,
  noMatch,
  readOnly,
  onAddAtEnd,
  tree,
}: {
  kind: BuilderKind;
  preview: boolean;
  renderPreview: () => ReactNode;
  empty: boolean;
  /** What was looked for, when nothing matches it. */
  noMatch: string | null;
  readOnly: boolean;
  onAddAtEnd: () => void;
  tree: ReactNode;
}): JSX.Element {
  if (preview) {
    return <section aria-label="What editors see">{renderPreview()}</section>;
  }
  if (empty) {
    return <EmptyState kind={kind} onAdd={onAddAtEnd} readOnly={readOnly} />;
  }
  return (
    <>
      {noMatch !== null && (
        <p className="text-sm text-muted-foreground">
          No field matches “{noMatch}”.
        </p>
      )}
      {tree}
      {!readOnly && (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <Button onClick={onAddAtEnd}>+ Add field</Button>
        </div>
      )}
    </>
  );
}
