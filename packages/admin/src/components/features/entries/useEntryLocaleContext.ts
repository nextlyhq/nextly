"use client";

/**
 * The content-locale context both document editors provide, assembled once.
 *
 * The entry editor and the single editor built this object separately and
 * almost identically, and the differences were the accidents of addressing
 * rather than decisions: an entry has a collection slug and an id, a single has
 * neither. Everything else — how the writing direction resolves, what counts as
 * a non-default language, which fields are translatable, what is withheld while
 * translation mode is on — is the same question twice.
 *
 * Two copies of it had already gone wrong once. Copy-from-language gated on
 * `collectionSlug && entryId`, which made the action collection-only by accident
 * of addressing rather than by intent, so a single could never offer it; the
 * repair was to make the source READ the seam. This module is the same repair
 * applied to the object itself, so the next rule added here cannot reach one
 * editor and miss the other.
 *
 * @module components/features/entries/useEntryLocaleContext
 */

import type { FieldConfig } from "nextly/config";
import { useMemo } from "react";

import { localizedFieldNamesOf } from "./entry-locale-source";
import type { EntryLocaleContextValue } from "./EntryLocaleContext";

export interface EntryLocaleContextInput {
  /** The active content language. `undefined` = the app default. */
  locale: string | undefined;
  /** The app default, which is what `undefined` above resolves to. */
  defaultLocale: string | undefined;
  /** Resolves a configured language's writing direction. */
  getLocale: (code: string | undefined) => { rtl?: boolean } | undefined;
  /** The document's master localization switch. */
  documentLocalized: boolean;
  /** The document's full field list, for the translatable-field set. */
  fields: FieldConfig[];
  /** Source-language values for the inline hint. */
  sourceValues: Record<string, unknown> | undefined;
  /** Whether translation mode is on, which withholds two of the values below. */
  inTranslationMode: boolean;
  onLocaleChange: EntryLocaleContextValue["onLocaleChange"];
  seedFromLocale: string | undefined;
  onSeedHandled: (() => void) | undefined;
  onEnterTranslationMode: ((source: string) => void) | undefined;
  /** How THIS editor reads another language — the seam that differs. */
  fetchSourceValues: EntryLocaleContextValue["fetchSourceValues"];
  publishAllLanguages: EntryLocaleContextValue["publishAllLanguages"];
  /** Entry-only addressing; a single supplies neither. */
  collectionSlug?: string | undefined;
  entryId?: string | undefined;
}

export function useEntryLocaleContext(
  input: EntryLocaleContextInput
): EntryLocaleContextValue {
  const {
    locale,
    defaultLocale,
    getLocale,
    documentLocalized,
    fields,
    sourceValues,
    inTranslationMode,
    onLocaleChange,
    seedFromLocale,
    onSeedHandled,
    onEnterTranslationMode,
    fetchSourceValues,
    publishAllLanguages,
    collectionSlug,
    entryId,
  } = input;

  return useMemo(
    () => ({
      locale,
      // `locale` is undefined while editing the implicit default language, so
      // resolve the default explicitly — otherwise a default language that is
      // RTL renders its translatable fields left-to-right until it is picked by
      // hand.
      rtl: getLocale(locale ?? defaultLocale)?.rtl ?? false,
      collectionLocalized: documentLocalized,
      isNonDefaultLocale:
        !!locale && !!defaultLocale && locale !== defaultLocale,
      // Withheld while translation mode is on: the inline hint and the source
      // pane answer the same question, and with both on the source text appears
      // three times on one screen. The pane is the better answer — it renders
      // every field type, where the hint could only render a string or a number.
      sourceValues: inTranslationMode ? undefined : sourceValues,
      // Withheld for the same reason in the other direction: the action must not
      // offer to enter a mode the author is already in.
      onEnterTranslationMode: inTranslationMode
        ? undefined
        : onEnterTranslationMode,
      onLocaleChange,
      seedFromLocale,
      onSeedHandled,
      collectionSlug,
      entryId,
      /** The translatable-field set, for the field-scoped copy-from action. */
      localizedFieldNames: localizedFieldNamesOf(fields, documentLocalized),
      // Copy-from-language reads its source THROUGH this seam instead of
      // addressing the document itself, so one implementation serves entries and
      // singles alike — a single has no collection slug or entry id and could
      // otherwise never offer the action at all.
      fetchSourceValues,
      publishAllLanguages,
    }),
    [
      locale,
      defaultLocale,
      getLocale,
      documentLocalized,
      fields,
      sourceValues,
      inTranslationMode,
      onLocaleChange,
      seedFromLocale,
      onSeedHandled,
      onEnterTranslationMode,
      fetchSourceValues,
      publishAllLanguages,
      collectionSlug,
      entryId,
    ]
  );
}
