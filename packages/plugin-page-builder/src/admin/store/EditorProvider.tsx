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
  /** Whether page-level custom CSS is editable in this mount (Edit view: yes; field mount: no — the host form owns persistence there). */
  pageCssEnabled: boolean;
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
  customCss,
  onDocumentChange,
  onCustomCssChange,
  children,
}: {
  document: BlockDocument;
  draftKey: string;
  /**
   * Initial page-level custom CSS. Passing a string (even "") enables the page-CSS
   * editor panel; leaving it undefined (field mount) hides it.
   */
  customCss?: string;
  /**
   * Fired whenever the document changes (skipping the initial mount) — used by the
   * field mount (`PageBuilderField`) to sync into the host react-hook-form. The full
   * Edit-view leaves this unset and persists via `SaveShell`.
   */
  onDocumentChange?: (document: BlockDocument) => void;
  /** Same contract as `onDocumentChange`, for the page custom CSS. */
  onCustomCssChange?: (customCss: string) => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () =>
    initialState(doc, customCss ?? "")
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  // Hold the latest callback in a ref so the sync effect depends ONLY on the document.
  // Callers (e.g. PageBuilderField) commonly pass an inline arrow — depending on its
  // identity would re-run the effect every render and, via the host form's onChange,
  // loop infinitely ("Maximum update depth exceeded").
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

  // Push document changes to a host form (field mount), not on the initial mount.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onDocumentChangeRef.current?.(state.document);
  }, [state.document]);

  // Same for the page custom CSS (its own first-render guard: CSS edits must sync
  // even before any document edit, and vice versa).
  const onCustomCssChangeRef = useRef(onCustomCssChange);
  onCustomCssChangeRef.current = onCustomCssChange;
  const firstCssRender = useRef(true);
  useEffect(() => {
    if (firstCssRender.current) {
      firstCssRender.current = false;
      return;
    }
    onCustomCssChangeRef.current?.(state.customCss);
  }, [state.customCss]);

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
    <EditorContext.Provider
      value={{ state, dispatch, pageCssEnabled: customCss !== undefined }}
    >
      {children}
    </EditorContext.Provider>
  );
}
