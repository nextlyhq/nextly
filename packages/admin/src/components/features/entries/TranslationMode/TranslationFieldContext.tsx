"use client";

/**
 * The source text a single field can be filled from, for the fields being
 * translated.
 *
 * Separate from `EntryLocaleContext` deliberately, and the reason is
 * structural rather than tidiness. Both panes sit inside the locale context —
 * the source pane needs the writing direction and the translatable-field set
 * as much as the target does — so a per-field "use the source" offered from
 * there would appear on the SOURCE fields too, where it means nothing and where
 * the form it would write to is the read-only one.
 *
 * This is provided around the target pane alone. The source pane is a sibling,
 * so it reads the default and offers nothing: the mistake is unrepresentable
 * rather than guarded against.
 *
 * @module components/features/entries/TranslationMode/TranslationFieldContext
 */

import { createContext, useContext } from "react";

export interface TranslationFieldContextValue {
  /**
   * The source document's values, keyed by field name.
   *
   * Absent outside translation mode and inside the source pane, which is what
   * makes both "no source to offer" without either having to know why.
   */
  sourceValues?: Record<string, unknown>;
  /** The source language's label, for naming the action after what it does. */
  sourceLabel?: string;
}

const TranslationFieldContext = createContext<TranslationFieldContextValue>({});

export const TranslationFieldProvider = TranslationFieldContext.Provider;

/** What a field can offer to fill itself from; empty outside translation mode. */
export function useTranslationField(): TranslationFieldContextValue {
  return useContext(TranslationFieldContext);
}
