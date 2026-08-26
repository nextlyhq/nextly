"use client";

/**
 * ONE copy-from state for a document, however many panels are on screen.
 *
 * The language panel renders twice by design — once in the document rail and
 * once inline — and the inline one is hidden with CSS rather than unmounted, so
 * at a wide width BOTH are live. Two `useCopyFromLanguage` calls means two
 * independent pending states, and a seed arriving from a language switch is
 * observed by both: two confirm dialogs stack for one action, and the author can
 * answer the same question twice.
 *
 * So the state is owned here, above every panel, and the confirm dialog is
 * rendered here too. A panel asks for the action; it does not own it. This is
 * the same shape `TranslationFieldContext` uses for the same reason — one
 * derivation, many renderers.
 *
 * Placed inside the form provider and the locale context because the action
 * reads both: it fills the form being edited, and it needs the language that
 * form is in.
 *
 * @module components/features/entries/CopyFromLanguageScope
 */

import { createContext, useContext, type ReactNode } from "react";

import { CopyFromLanguageDialog } from "./CopyFromLanguageDialog";
import {
  useCopyFromLanguage,
  type CopyFromLanguage,
} from "./useCopyFromLanguage";

const CopyFromLanguageContext = createContext<CopyFromLanguage | undefined>(
  undefined
);

/**
 * The document's copy-from state, or `undefined` outside a scope.
 *
 * Undefined rather than throwing: a panel can legitimately render in a test or
 * a preview with no scope around it, and the action simply is not offered
 * there. A throw would make the absence of an optional action fatal.
 */
export function useCopyFromLanguageScope(): CopyFromLanguage | undefined {
  return useContext(CopyFromLanguageContext);
}

export function CopyFromLanguageScope({ children }: { children: ReactNode }) {
  const copy = useCopyFromLanguage();
  return (
    <CopyFromLanguageContext.Provider value={copy}>
      {children}
      {/* Rendered once, beside the state it reads. A dialog per panel is the
          defect this component exists to remove. */}
      <CopyFromLanguageDialog copy={copy} />
    </CopyFromLanguageContext.Provider>
  );
}
