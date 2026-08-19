"use client";

/**
 * A field saying it holds work the form's values do not contain.
 *
 * The form decides what "unsaved" means for everything it can see, and that is
 * nearly always enough: a field writes through `react-hook-form`, so the dirty
 * flag moves and the guard, the save shortcut and the header all follow.
 *
 * It is not enough for a field that holds its own editing state. The page
 * builder is the case in hand: it opens over the form, keeps the block document
 * in its own store, and commits on EXIT — deliberately, so the form's undo and
 * the editor's undo are not two answers to one question. The cost is that
 * through an entire editing session the form is not dirty, and everything
 * derived from that flag is wrong in the same direction at once:
 *
 * - the unsaved-changes guard does not warn on navigation, on back, or on
 *   closing the tab;
 * - the save shortcut declines, because its `when` reads the same flag;
 * - the header shows no pending work.
 *
 * ## What this is NOT
 *
 * A way for a field to save, publish, or write to the form. It reports one
 * boolean about itself. The form still decides what to do about it, which is
 * the difference between telling someone the kettle is boiling and being
 * allowed to pour.
 *
 * @module components/features/entries/EntryForm/UnsavedWorkContext
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** How a surface reports itself. `null` outside a form, where nobody is asking. */
type Report = ((key: string, unsaved: boolean) => void) | null;

const UnsavedWorkContext = createContext<Report>(null);

export interface UnsavedWork {
  /** Whether any surface inside the form says it holds unsaved work. */
  anyUnsaved: boolean;
  /** Passed to {@link UnsavedWorkProvider}. */
  report: (key: string, unsaved: boolean) => void;
}

/**
 * Held by the FORM, above the guard that reads it.
 *
 * A set rather than a boolean because a document may hold more than one such
 * surface — two blocks fields on one page is an ordinary schema — and a single
 * flag would let the second to report `false` clear the first one's work.
 *
 * @returns whether anything is unsaved, and the reporter to provide
 */
export function useUnsavedWork(): UnsavedWork {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());

  const report = useCallback((key: string, unsaved: boolean) => {
    setKeys(current => {
      // The SAME set back when nothing changed. Returning a new one would
      // re-render the whole form on every report, and a surface that reports on
      // each edit would re-render it on every keystroke.
      if (current.has(key) === unsaved) return current;
      const next = new Set(current);
      if (unsaved) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  return { anyUnsaved: keys.size > 0, report };
}

/**
 * The whole question a form asks: is there unsaved work anywhere in me?
 *
 * Combines the form's own dirty flag with what its fields report, so the rule
 * is stated once rather than in each editor. Two copies of `isDirty || …` would
 * agree today and drift the first time one of them gained a third source.
 *
 * @param formIsDirty - the form library's own answer about its values
 * @returns the combined answer, and the reporter to provide to fields
 */
export function useFormUnsavedWork(formIsDirty: boolean): {
  hasUnsavedWork: boolean;
  report: (key: string, unsaved: boolean) => void;
} {
  const { anyUnsaved, report } = useUnsavedWork();
  return { hasUnsavedWork: formIsDirty || anyUnsaved, report };
}

export function UnsavedWorkProvider({
  report,
  children,
}: {
  report: (key: string, unsaved: boolean) => void;
  children: ReactNode;
}) {
  return (
    <UnsavedWorkContext.Provider value={report}>
      {children}
    </UnsavedWorkContext.Provider>
  );
}

/**
 * Report that this surface holds work the form cannot see.
 *
 * Retracted when the surface unmounts, which is the handoff that makes this
 * safe: the page builder commits its document on the way out, so the form goes
 * dirty in the same moment this stops claiming anything. Without the retraction
 * a closed editor would leave the form permanently "unsaved".
 *
 * Silently does nothing outside a form. A field also renders in previews and
 * pickers, where there is nobody to tell.
 *
 * @param key - identifies this surface among any others reporting
 * @param unsaved - whether it currently holds unsaved work
 */
export function useReportUnsavedWork(key: string, unsaved: boolean): void {
  const report = useContext(UnsavedWorkContext);

  useEffect(() => {
    report?.(key, unsaved);
  }, [report, key, unsaved]);

  /*
   * The retraction reads the key from a ref rather than closing over it, so a
   * surface whose key changed retracts the key it actually reported. Closing
   * over `key` would need it in the dependency list, which would run the
   * cleanup on every key change and turn this into the per-change retraction
   * the effect above already handles.
   */
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    return () => {
      report?.(keyRef.current, false);
    };
  }, [report]);
}
