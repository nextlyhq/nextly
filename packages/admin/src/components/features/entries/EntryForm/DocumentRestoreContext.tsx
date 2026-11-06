"use client";

/**
 * How a document view restores its own field from a recovery point: as an
 * edit of its own, which the author can undo, rather than by being drawn
 * afresh over the restored values, which starts its history again.
 *
 * The view registers a handler; the body's Restore asks it first. A view that
 * registers none, or declines, is restored the old way.
 *
 * @module components/features/entries/EntryForm/DocumentRestoreContext
 */
import type { JSX, ReactNode } from "react";
import { createContext, useContext, useLayoutEffect, useRef } from "react";

/**
 * Applies the field's recovered value as one edit the author can undo.
 * Returns false to decline, and the document is then restored the old way.
 */
export type DocumentRestoreHandler = (value: unknown) => boolean;

/** Where the view's handler is kept, for the body's Restore to ask. */
export interface DocumentRestoreRegistry {
  current: DocumentRestoreHandler | null;
}

const DocumentRestoreContext = createContext<DocumentRestoreRegistry | null>(
  null
);

export function DocumentRestoreProvider({
  registry,
  children,
}: {
  registry: DocumentRestoreRegistry;
  children: ReactNode;
}): JSX.Element {
  return (
    <DocumentRestoreContext.Provider value={registry}>
      {children}
    </DocumentRestoreContext.Provider>
  );
}

/**
 * Registers how this document view restores its own field from a recovery
 * point (@experimental).
 *
 * While registered, Restore resets every OTHER field to the recovery point
 * and calls `restore` with this field's recovered value, unparsed, instead of
 * drawing the view afresh: the view applies it as an edit of its own, so the
 * author can undo it. Return false to decline (a value the view can't apply
 * as an edit), and the document is restored the old way. One handler per
 * view; a later registration replaces an earlier one. Does nothing outside a
 * document view.
 *
 * @param restore - applies the field's recovered value, or declines
 */
export function useDocumentRestore(restore: DocumentRestoreHandler): void {
  const registry = useContext(DocumentRestoreContext);
  // The latest handler, read when Restore runs, so a view re-rendering with a
  // new closure neither re-registers nor runs a stale one.
  const latest = useRef(restore);
  useLayoutEffect(() => {
    latest.current = restore;
  });
  useLayoutEffect(() => {
    if (registry === null) return;
    const handler: DocumentRestoreHandler = value => latest.current(value);
    registry.current = handler;
    return () => {
      if (registry.current === handler) registry.current = null;
    };
  }, [registry]);
}
