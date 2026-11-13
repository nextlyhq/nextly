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
import { focusHolding } from "@admin/lib/builder/outline/focus-view";
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

import { FocusCrumbs } from "./FocusCrumbs";
import { MoveToDialog } from "./MoveToDialog";
import type { OutlineActions, OutlineCallbacks } from "./outline-types";
import { OutlineToolbar } from "./OutlineToolbar";
import { OutlineTree } from "./OutlineTree";
import { SystemFieldsContainer } from "./SystemFieldsContainer";
import { useFieldTypeLabel } from "./useFieldTypeLabel";
import {
  useOutlineActions,
  type OutlineActionState,
} from "./useOutlineActions";
import { useOutlineDrag } from "./useOutlineDrag";
import { useOutlineFocus, type OutlineFocus } from "./useOutlineFocus";
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
  setFolded: (update: (prev: Set<string>) => Set<string>) => void,
  focus: OutlineFocus
): void {
  useEffect(() => {
    const drawn = (id: string) => rows.some(row => row.node.id === id);
    const id = state.takeRefocus(drawn);
    if (id === null) return;
    if (drawn(id)) {
      state.focusRow(id, true);
      return;
    }
    // A move took the field out of the focused container: Focus follows it to
    // the container holding it now, or ends at the top level, so the field
    // stays in view and keeps focus. The asked-for refocus waits for that.
    const { focused } = focus.view;
    if (
      focused &&
      !flattenOutline(focused.children).some(node => node.id === id) &&
      flattenOutline(nodes).some(node => node.id === id)
    ) {
      focus.show(focusHolding(nodes, id));
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

/** Keyboard focus on the row a change of Focus asked for, once it is drawn. */
function useReturnAfterFocus(
  focus: OutlineFocus,
  rows: readonly VisibleRow[],
  state: OutlineActionState
): void {
  useEffect(() => {
    const id = focus.takeReturn(target =>
      rows.some(row => row.node.id === target)
    );
    if (id !== null) state.focusRow(id, true);
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

/**
 * What the outline keeps while it is drawn: what is folded and looked for,
 * whether the preview is on, the rows that shows, and the actions, keys and
 * focus over those rows.
 */
function useOutlineView(
  nodes: readonly OutlineNode[],
  callbacks: OutlineCallbacks,
  foldKey: string
) {
  const typeLabel = useFieldTypeLabel();
  const { folded, setFolded, toggle } = useFolding(foldKey);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const state = useOutlineActions(nodes, callbacks);
  const focus = useOutlineFocus(nodes);
  const { view: shown } = focus;
  const rows = useMemo(
    () => visibleRows(shown.nodes, folded, query, typeLabel, shown.rootLevel),
    [shown, folded, query, typeLabel]
  );
  // Focus is one more action on a row: once a container is shown on its own,
  // its first field takes keyboard focus, since its own row is not drawn.
  const actions = useMemo<OutlineActions>(
    () => ({
      ...state.actions,
      focusContainer: id =>
        focus.show(id, [
          flattenOutline(nodes).find(node => node.id === id)?.children[0]?.id ??
            null,
        ]),
    }),
    [state.actions, focus, nodes]
  );
  useRefocusAfterMove(state, rows, nodes, folded, setFolded, focus);
  useReturnAfterFocus(focus, rows, state);
  const onKeyDown = useTreeKeyDown({
    rows,
    actions,
    focusRow: state.focusRow,
    toggle,
  });
  // The tab stop follows focus, so Tab back into the tree lands on the row
  // last focused, however it was reached.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const id = rowIdOf(event.target);
    if (id !== null) state.setFocusedId(id);
  };
  return {
    typeLabel,
    setFolded,
    toggle,
    query,
    setQuery,
    preview,
    setPreview,
    state,
    actions,
    focus,
    rows,
    finding: query.trim() !== "",
    onKeyDown,
    onFocus,
  };
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
  const view = useOutlineView(nodes, callbacks, foldKey);
  const { state, rows, finding, setFolded } = view;
  const movesId = useId();

  const tree = (
    <OutlineTree
      rows={rows}
      addable={!readOnly && !finding}
      finding={finding}
      typeLabel={view.typeLabel}
      errors={errors}
      selectedId={selectedId}
      tabStopId={tabStopOf(rows, state.focusedId, selectedId)}
      menuFor={state.menuFor}
      actions={view.actions}
      registerRow={state.registerRow}
      onToggle={view.toggle}
      onAddAt={callbacks.addAt}
      onKeyDown={view.onKeyDown}
      onFocus={view.onFocus}
      movesDescribedBy={movesId}
    />
  );

  return (
    <div className="space-y-4 p-4">
      <SystemFieldsContainer systemFields={systemFields} />
      <OutlineToolbar
        query={view.query}
        onQueryChange={view.setQuery}
        onFoldAll={() => setFolded(() => new Set(containerPaths(nodes)))}
        onUnfoldAll={() => setFolded(() => new Set())}
        preview={view.preview}
        onPreviewChange={view.setPreview}
      />
      {view.focus.view.focused && (
        <FocusCrumbs
          crumbs={view.focus.view.crumbs}
          // Back with the selection kept: focus goes to the selected field if
          // that level draws it, else to the container that was focused.
          onGo={id =>
            view.focus.show(id, [
              selectedId,
              view.focus.view.focused?.id ?? null,
            ])
          }
          onExit={() =>
            view.focus.show(null, [
              selectedId,
              view.focus.view.focused?.id ?? null,
            ])
          }
        />
      )}
      <OutlineBody
        kind={kind}
        preview={view.preview}
        renderPreview={renderPreview}
        empty={nodes.length === 0}
        noMatch={finding && rows.length === 0 ? view.query.trim() : null}
        readOnly={readOnly}
        onAddAtEnd={() => callbacks.addAt({})}
        tree={tree}
      />
      <OutlineMoves
        state={state}
        actions={view.actions}
        fields={callbacks.fields}
        keysId={movesId}
      />
      {/* Mounted from the start, so a screen reader is already watching it
          when a move is announced. */}
      <div aria-live="polite" className="sr-only">
        {state.announcement}
      </div>
    </div>
  );
}

/**
 * What moving a field adds to the outline: why the place a drag is over is
 * refused, while it is; the keys a row's description names; and Move to….
 */
function OutlineMoves({
  state,
  actions,
  fields,
  keysId,
}: {
  state: OutlineActionState;
  actions: OutlineActions;
  fields: OutlineCallbacks["fields"];
  keysId: string;
}): JSX.Element {
  const refusedHere = useOutlineDrag(actions);
  return (
    <>
      {refusedHere && <p className="text-sm text-destructive">{refusedHere}</p>}
      <p id={keysId} hidden>
        Alt+Up and Alt+Down move the field; Alt+Left moves it out of its
        container, Alt+Right into the container above it. Shift+F10 opens its
        actions, Move to… among them.
      </p>
      {state.moveToFor !== null && (
        <MoveToDialog
          fieldId={state.moveToFor}
          fields={fields}
          actions={actions}
          onClose={state.closeMoveTo}
        />
      )}
    </>
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
