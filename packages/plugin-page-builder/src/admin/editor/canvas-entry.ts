"use client";

/**
 * The entry the canvas draws the document as: the document's own, or, for a
 * template, the entry of its collection being previewed.
 *
 * A page is drawn as itself, so its bindings, its lists of related entries
 * and its conditions read the entry the form holds. A template is stored as
 * an entry of the templates collection, which none of its bindings mean: it
 * draws an entry of the collection it names. So the template's editor hands
 * the canvas that entry instead, and everything that reads the canvas's
 * entry (the binding sources, the page context, the inspector's
 * `entryCollection`) asks here rather than of the document's identity.
 *
 * @module canvas-entry
 */
import {
  useDocumentIdentity,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

/** The entry the canvas is drawn as, where the editor gives one. */
const CanvasEntry = createContext<
  { readonly identity: DocumentIdentity | null } | undefined
>(undefined);

/**
 * Draw the canvas as `identity` rather than as the document: a collection
 * and, while an entry is previewed, its id; `null` where there is no
 * collection to draw an entry of.
 */
export function CanvasEntryProvider({
  identity,
  children,
}: {
  readonly identity: DocumentIdentity | null;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return createElement(CanvasEntry.Provider, { value: { identity } }, children);
}

/**
 * The entry the canvas is drawn as: the one the editor gives, else the
 * document's own identity.
 */
export function useCanvasEntryIdentity(): DocumentIdentity | null {
  const own = useDocumentIdentity();
  const given = useContext(CanvasEntry);
  return given === undefined ? own : given.identity;
}
