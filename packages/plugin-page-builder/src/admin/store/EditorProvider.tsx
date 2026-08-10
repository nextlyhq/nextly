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
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";

import { documentNodeClasses } from "../../core/style-compiler";
import type { BlockDocument } from "../../core/types";
import type { RemotePatternInput } from "../../core/url-policy";

import {
  editorReducer,
  initialState,
  type EditorAction,
  type EditorState,
} from "./editorStore";

/** Stable identity so the context value does not change on every render. */
const EMPTY_PATTERNS: readonly RemotePatternInput[] = [];

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Whether page-level custom CSS is editable in this mount (Edit view: yes; field mount: no — the host form owns persistence there). */
  pageCssEnabled: boolean;
  /**
   * The hosts block images may load from, as the published page will apply
   * them. The preview compiles with the same list so an allowed off-origin
   * background does not vanish in the editor and reappear on the page.
   */
  remotePatterns: readonly RemotePatternInput[];
  /**
   * The document's node classes, with any hash collision disambiguated.
   *
   * Held here so the preview's markup and the stylesheet compiled beside it are
   * named from ONE map. Derived from the whole document, which is the only
   * scope a collision is visible at, and memoized on it so a keystroke that
   * does not change the tree does not rebuild it.
   */
  nodeClasses: ReadonlyMap<string, string>;
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
  remotePatterns,
  onDocumentChange,
  onCustomCssChange,
  children,
}: {
  document: BlockDocument;
  draftKey: string;
  /**
   * The hosts block images may load from. Must match what the page is rendered
   * with, or the preview and the published page disagree about which images
   * exist.
   *
   * The registered surfaces — `PageBuilderEditView` and `PageBuilderField` —
   * supply it through `useRemotePatterns()`, which reads the plugin's own
   * `clientConfig`. That channel is what carries server-side plugin
   * configuration to a client component, so a host declaring
   * `pageBuilder({ remotePatterns })` gets the same allowlist in the canvas
   * that the editor's compiler enforces.
   *
   * A caller passing nothing still gets an empty list, and an empty list is
   * STRICTER than an absent one: the canvas drops remote backgrounds rather
   * than showing forbidden ones, so the failure costs preview fidelity and not
   * safety. That is the deliberate direction for a value that did not arrive.
   */
  remotePatterns?: readonly RemotePatternInput[];
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
  const nodeClasses = useMemo(
    () => documentNodeClasses(state.document),
    [state.document]
  );

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
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            document: state.document,
            customCss: state.customCss,
          })
        );
      } catch {
        /* quota / unavailable — ignore */
      }
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.document, state.customCss, state.dirty, draftKey]);

  return (
    <EditorContext.Provider
      value={{
        state,
        dispatch,
        pageCssEnabled: customCss !== undefined,
        remotePatterns: remotePatterns ?? EMPTY_PATTERNS,
        nodeClasses,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}
