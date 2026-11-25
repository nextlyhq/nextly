"use client";

/**
 * The editor's undo history kept while the builder's view draws the
 * read-only page.
 *
 * The view swaps the editor for the read-only page while the document's lock
 * is lost (a connection that dropped, a colleague who took it over), and
 * mounts it again once the lock is back. A new editor starts with an empty
 * history, so the author's undo would be gone. The view keeps what the editor
 * hands over as it unmounts for that reason, and the editor that mounts again
 * for the same person, document, language and field starts from it.
 *
 * The editor state starts from it only on the very page it was left on
 * (`startsFromKept`): someone else's change loaded meanwhile makes it a page
 * the kept undo was not built against, and it starts fresh. The page's save
 * point is kept beside it and follows the same answer, so a page saved before
 * the lock was lost does not read as unsaved after.
 *
 * Held by the view, one at a time, so it goes when the view does: leaving the
 * builder for good keeps nothing.
 *
 * @module admin/editor/kept-editor
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  startsFromKept,
  type EditorStateKeeping,
  type KeptEditorState,
} from "@nextlyhq/builder/shell";
import {
  useCurrentUserId,
  useDocumentIdentity,
  useDocumentLocale,
} from "@nextlyhq/plugin-sdk/admin";
import {
  type Context,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SavedAt } from "./use-host-commit";

/** What an editor that closed for the read-only page left. */
interface KeptEditor {
  readonly editor: KeptEditorState;
  /** Where the page's history stood at its last store (`useSavePoint`). */
  readonly savedAt: SavedAt;
}

/** Where the view keeps what its editor left, handed to the editor. */
export interface EditorKeeper {
  /** What the last editor here left, when it was left for this same owner. */
  readonly kept: () => KeptEditor | undefined;
  /** An editor unmounting: kept only while the view is turning read-only. */
  readonly keep: (editor: KeptEditorState, savedAt: SavedAt) => void;
  /** The editor that mounted has read what was kept; it is held no longer. */
  readonly taken: () => void;
}

/**
 * The keeper of the builder's view around the editor, provided by the view;
 * absent for an editor opened anywhere else, which keeps nothing.
 */
export const EditorKeeperContext: Context<EditorKeeper | undefined> =
  createContext<EditorKeeper | undefined>(undefined);

/**
 * Whose history it is: the person, the document, its language and the field.
 * Nothing (and nothing kept) until each is known, so a history can never be
 * handed across any of them.
 */
function ownerOf(
  userId: string | null,
  identity: ReturnType<typeof useDocumentIdentity>,
  locale: ReturnType<typeof useDocumentLocale>,
  address: string | undefined
): string | null {
  if (userId === null || identity?.documentId === undefined) return null;
  if (address === undefined) return null;
  return JSON.stringify([
    userId,
    identity.kind,
    identity.slug,
    identity.documentId,
    locale?.code ?? null,
    address,
  ]);
}

/**
 * The view's keeper: holds at most one editor's history, while the view is
 * read-only, and lets it go as the view unmounts.
 *
 * @param readOnly - whether the view draws the read-only page now
 * @param address - the field's address the view is open on
 */
export function useEditorKeeper(
  readOnly: boolean,
  address: string | undefined
): EditorKeeper {
  const owner = ownerOf(
    useCurrentUserId(),
    useDocumentIdentity(),
    useDocumentLocale(),
    address
  );
  // Read when an editor unmounts or mounts, which is after the render that
  // swapped it, so they answer for the view as it is drawn now.
  const now = useRef({ owner, readOnly });
  now.current = { owner, readOnly };
  const held = useRef<{ owner: string; kept: KeptEditor } | null>(null);
  useEffect(
    () => () => {
      held.current = null;
    },
    []
  );
  return useMemo(
    () => ({
      kept: () => {
        const kept = held.current;
        return kept !== null && kept.owner === now.current.owner
          ? kept.kept
          : undefined;
      },
      keep: (editor, savedAt) => {
        const { owner: keptFor, readOnly: forReadOnly } = now.current;
        held.current =
          forReadOnly && keptFor !== null
            ? { owner: keptFor, kept: { editor, savedAt } }
            : null;
      },
      taken: () => {
        held.current = null;
      },
    }),
    []
  );
}

/** What the editor's mount reads from the keeper (`useKeptEditor`). */
export interface KeptEditorMount {
  /** Handed to the page's editor state, so it starts from and keeps a history. */
  readonly keeping: EditorStateKeeping | undefined;
  /** Where the page's save point starts: the kept one where the history is. */
  readonly savedAt: SavedAt;
  /** The save point as it stands, kept with the history as the editor leaves. */
  readonly report: (savedAt: SavedAt) => void;
}

/**
 * The editor's side of the keeper: what it starts from, read once as it
 * mounts, and where it hands its own history and save point as it unmounts.
 * No keeper (an editor opened anywhere but the view), nothing is kept.
 */
export function useKeptEditor(initialDocument: BlockDocument): KeptEditorMount {
  const keeper = useContext(EditorKeeperContext);
  const [start] = useState(() => {
    const kept = keeper?.kept();
    return {
      editor: kept?.editor,
      savedAt:
        kept !== undefined && startsFromKept(kept.editor, initialDocument)
          ? kept.savedAt
          : 0,
    };
  });
  useEffect(() => {
    keeper?.taken();
  }, [keeper]);
  const savedAt = useRef<SavedAt>(start.savedAt);
  const keeping = useMemo<EditorStateKeeping | undefined>(
    () =>
      keeper === undefined
        ? undefined
        : {
            kept: start.editor,
            keep: editor => keeper.keep(editor, savedAt.current),
          },
    [keeper, start]
  );
  return useMemo(
    () => ({
      keeping,
      savedAt: start.savedAt,
      report: (at: SavedAt) => {
        savedAt.current = at;
      },
    }),
    [keeping, start]
  );
}
