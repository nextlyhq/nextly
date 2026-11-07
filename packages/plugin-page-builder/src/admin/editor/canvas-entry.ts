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
  useMemo,
  type ReactNode,
} from "react";

/**
 * Where the canvas's own read of the entry it is drawn as stands: on its
 * way, answered, failed, or not needed (nothing on the canvas is bound), for
 * the entry `entryId` names.
 */
export interface CanvasEntryRead {
  readonly entryId: string | undefined;
  readonly state: "pending" | "answered" | "failed" | "none";
}

/** What the editor gives the canvas, where it gives anything. */
interface CanvasEntryGiven {
  readonly identity: DocumentIdentity | null;
  /** Bumped to ask the canvas's read again, as a retry asks it. */
  readonly retry: number;
  /** Told where the canvas's read stands, so a strip names what it draws. */
  readonly onRead: ((read: CanvasEntryRead) => void) | undefined;
}

/** The entry the canvas is drawn as, where the editor gives one. */
const CanvasEntry = createContext<CanvasEntryGiven | undefined>(undefined);

/**
 * Draw the canvas as `identity` rather than as the document: a collection
 * and, while an entry is previewed, its id; `null` where there is no
 * collection to draw an entry of. `retry` asks the canvas's read again when
 * bumped, and `onRead` hears where that read stands.
 */
export function CanvasEntryProvider({
  identity,
  retry = 0,
  onRead,
  children,
}: {
  readonly identity: DocumentIdentity | null;
  readonly retry?: number;
  readonly onRead?: (read: CanvasEntryRead) => void;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const value = useMemo(
    () => ({ identity, retry, onRead }),
    [identity, retry, onRead]
  );
  return createElement(CanvasEntry.Provider, { value }, children);
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

/**
 * What the canvas's read takes from the editor besides the identity: the
 * retry count and where to say how the read stands. Nothing to tell, and no
 * retry, where the editor gives no entry.
 */
export function useCanvasEntryRead(): Pick<
  CanvasEntryGiven,
  "retry" | "onRead"
> {
  const given = useContext(CanvasEntry);
  return { retry: given?.retry ?? 0, onRead: given?.onRead };
}
