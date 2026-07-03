"use client";

/**
 * Editor context + reducer wiring (spec §9). Provides the store to the canvas,
 * inspector, and save shell, and debounces a localStorage draft per entry so a crash
 * doesn't lose work. `useEditor()` is the access hook.
 */
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";

import type { BlockDocument } from "../../core/types";

import {
  editorReducer,
  initialState,
  type EditorAction,
  type EditorState,
} from "./editorStore";

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside <EditorProvider>");
  return ctx;
}

export function draftKeyFor(
  collectionSlug: string,
  entryId: string | undefined
): string {
  return `nx-pb-draft:${collectionSlug}:${entryId ?? "new"}`;
}

export function EditorProvider({
  document: doc,
  draftKey,
  onDocumentChange,
  children,
}: {
  document: BlockDocument;
  draftKey: string;
  /**
   * Fired whenever the document changes (skipping the initial mount) — used by the
   * field mount (`PageBuilderField`) to sync into the host react-hook-form. The full
   * Edit-view leaves this unset and persists via `SaveShell`.
   */
  onDocumentChange?: (document: BlockDocument) => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, doc, initialState);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  // Push document changes to a host form (field mount), not on the initial mount.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onDocumentChange?.(state.document);
  }, [state.document, onDocumentChange]);

  // Debounced draft autosave (only while there are unsaved changes).
  useEffect(() => {
    if (!state.dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(state.document));
      } catch {
        /* quota / unavailable — ignore */
      }
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.document, state.dirty, draftKey]);

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      {children}
    </EditorContext.Provider>
  );
}
