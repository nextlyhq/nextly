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
}

const EntryLocaleContext = createContext<EntryLocaleContextValue>({
  rtl: false,
});

export const EntryLocaleProvider = EntryLocaleContext.Provider;

/** Read the active content-locale context (defaults to LTR / no locale). */
export function useEntryLocale(): EntryLocaleContextValue {
  return useContext(EntryLocaleContext);
}
