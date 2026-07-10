/**
 * EntryLocaleContext — carries the entry editor's active content language down to field
 * components (i18n M7), so a field can render its input in the language's writing direction
 * without threading the locale through every prop.
 *
 * Default is a non-localized editor (`rtl: false`), so components using fields outside a
 * localized entry form are unchanged.
 *
 * @module components/features/entries/EntryLocaleContext
 */

import { createContext, useContext } from "react";

export interface EntryLocaleContextValue {
  /** The active content locale code (undefined = the app default). */
  locale?: string;
  /** Whether the active locale is written right-to-left. */
  rtl: boolean;
  /** The collection's master localization switch (drives per-field translatability). */
  collectionLocalized: boolean;
  /**
   * Whether the active locale differs from the app default. Field-level i18n affordances
   * (the "shared across languages" hint, the inline source-text hint) only apply while
   * editing a non-default language — editing the default language is the plain path.
   */
  isNonDefaultLocale: boolean;
  /**
   * Default-language field values, keyed by field name (camelCase). Present while translating a
   * non-default language so a translatable field can show its source text inline (spec §10).
   */
  sourceValues?: Record<string, unknown>;
  /** Switch the active editing language — lets in-form surfaces (status pills) change locale. */
  onLocaleChange?: (code: string) => void;
}

const EntryLocaleContext = createContext<EntryLocaleContextValue>({
  rtl: false,
  collectionLocalized: false,
  isNonDefaultLocale: false,
});

export const EntryLocaleProvider = EntryLocaleContext.Provider;

/** Read the active content-locale context (defaults to LTR / no locale / non-localized). */
export function useEntryLocale(): EntryLocaleContextValue {
  return useContext(EntryLocaleContext);
}
