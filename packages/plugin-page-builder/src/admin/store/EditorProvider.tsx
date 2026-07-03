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
  children,
}: {
  document: BlockDocument;
  draftKey: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, doc, initialState);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
