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
  /**
   * Switch the active editing language — lets in-form surfaces change locale.
   *
   * `seedFrom` asks that, once the switch lands, the newly active language be
   * seeded from the named one. It travels WITH the switch because a locale
   * change refetches the document and tears the editor's subtree down: an
   * intent recorded inside that subtree is destroyed before it can be acted
   * on. Whoever owns `locale` owns this too, so the pair cannot be separated.
   */
  onLocaleChange?: (code: string, options?: { seedFrom?: string }) => void;
  /**
   * A seed requested by the switch that just happened: copy the active
   * language's content from this one. Consumed once, then cleared through
   * `onSeedHandled`.
   */
  seedFromLocale?: string;
  /** Clears `seedFromLocale` so a later re-render cannot re-offer the same seed. */
  onSeedHandled?: () => void;
  /** Collection slug — lets in-form surfaces (copy-from-language) fetch another locale's values. */
  collectionSlug?: string;
  /** The entry's id (edit mode) — the source fetch target for copy-from-language. */
  entryId?: string;
  /** Names of this collection's translatable fields — the field-scoped set copy-from-language copies. */
  localizedFieldNames?: string[];
  /**
   * Read another language's raw values for this document, for copy-from-language.
   *
   * Supplied by the form rather than resolved here because entries and singles
   * are addressed differently — an entry by collection slug and id, a single by
   * its slug alone. Making the FETCH the seam lets one copy-from implementation
   * serve both, instead of the action existing only where its address shape
   * happened to be hardcoded.
   *
   * Absent means the surface cannot fetch a source, and copy-from does not offer
   * itself.
   */
  fetchSourceValues?: (locale: string) => Promise<Record<string, unknown>>;
  /**
   * Publish every language of this document at once.
   *
   * Supplied by the form for the same reason `fetchSourceValues` is: entries
   * and singles are addressed differently, and the mutation each owns carries
   * its own query keys. Making the ACTION the seam lets one availability rule
   * serve both, instead of the action existing only where its address shape
   * happened to be hardcoded.
   *
   * Absent means the surface cannot publish every language, and the action does
   * not offer itself.
   */
  publishAllLanguages?: {
    /**
     * The slug whose `publish-{slug}` permission this owes. The permission
     * NAME is built by the shared rule, not here, so the two surfaces cannot
     * come to disagree about what publishing is called.
     */
    slug: string;
    /** Issue the publish and refresh the document. */
    publish: () => void;
    /** True while it is in flight. */
    pending: boolean;
  };
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
