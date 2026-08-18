"use client";

/**
 * What translation mode shows on its source side, assembled the same way for
 * both editors.
 *
 * The entry editor and the single editor differ in how they ADDRESS a document
 * — a collection slug and an id, or a slug alone — and in nothing else that
 * matters here. Both hold a field list, a localization flag, the language being
 * edited and a source document, and both have to turn those into the same pane.
 * Two copies would agree the day they were written and drift the moment one
 * learned something about which fields belong on screen, which is the kind of
 * drift a reader cannot see: the pane would simply show a different set of
 * fields on one editor.
 *
 * @module components/features/entries/TranslationMode/useTranslationSource
 */

import type { FieldConfig } from "nextly/config";
import { useMemo } from "react";

import { localizedFieldNamesOf } from "@admin/components/features/entries/entry-locale-source";
import { getDefaultValues } from "@admin/lib/form/default-values";

import type { SourcePaneDocument } from "./SourceDocumentPane";

/** What an editor is handed about translation mode, straight from its page. */
export interface TranslationModeProps {
  from?: string | undefined;
  sourceDocument?: Record<string, unknown> | undefined;
  onEnter?: ((source: string) => void) | undefined;
  onExit?: (() => void) | undefined;
}

/** What an editor needs to render it, with every absent case already resolved. */
export interface TranslationModeView {
  /** The source pane's document, or undefined when the mode is off. */
  source: SourcePaneDocument | undefined;
  /** Whether the mode is on, which withholds the inline hint and the enter action. */
  active: boolean;
  /** Offered only while the mode is OFF, so it cannot re-enter itself. */
  onEnter: ((source: string) => void) | undefined;
  onExit: (() => void) | undefined;
}

export interface TranslationSourceInput {
  /** The document's full field list. */
  fields: FieldConfig[];
  /** The document's master localization switch. */
  documentLocalized: boolean;
  /** The page's translation-mode props, undefined on an editor without them. */
  translation: TranslationModeProps | undefined;
  /** The language being edited. `undefined` = the app default. */
  locale: string | undefined;
  /** The app default, which is what `undefined` above resolves to. */
  defaultLocale: string | undefined;
  /** Resolves a configured language's label and writing direction. */
  getLocale: (
    code: string | undefined
  ) => { label?: string; rtl?: boolean } | undefined;
}

/**
 * A configured language's human label, falling back to its own code.
 *
 * Its own function because the fallback chain is the bulk of this module's
 * branching and none of it is interesting: a language the app configures always
 * has a label, so every branch here describes a misconfiguration rather than a
 * case worth reading inline.
 */
function labelFor(
  getLocale: TranslationSourceInput["getLocale"],
  code: string | undefined,
  fallback: string
): string {
  return getLocale(code)?.label ?? code ?? fallback;
}

export function useTranslationSource({
  fields,
  documentLocalized,
  translation,
  locale,
  defaultLocale,
  getLocale,
}: TranslationSourceInput): TranslationModeView {
  const translateFrom = translation?.from;
  const sourceDocument = translation?.sourceDocument;

  const source = useMemo(() => {
    if (!translateFrom || !sourceDocument) return undefined;

    // Only the TRANSLATABLE fields. A shared field holds the same value in both
    // languages, so putting it in the source pane would fill half the screen
    // with a copy of what is already in the other one — and push the fields that
    // DO differ off it.
    const translatable = new Set(
      localizedFieldNamesOf(fields, documentLocalized)
    );
    const paneFields = fields.filter(
      f => "name" in f && !!f.name && translatable.has(f.name)
    );

    const target = locale ?? defaultLocale;
    return {
      sourceLocale: translateFrom,
      sourceLabel: labelFor(getLocale, translateFrom, translateFrom),
      targetLabel: labelFor(getLocale, target, ""),
      rtl: getLocale(translateFrom)?.rtl ?? false,
      fields: paneFields,
      // The same normaliser the live editor uses to seed itself from an API
      // document — snake_case fallbacks, chips arriving as JSON strings, a
      // structural null materialised. A second one here would disagree with the
      // target pane about what the document says.
      values: getDefaultValues(paneFields, sourceDocument),
    };
  }, [
    fields,
    documentLocalized,
    translateFrom,
    sourceDocument,
    locale,
    defaultLocale,
    getLocale,
  ]);

  // `active` is the SOURCE's presence, not the param's. A named language whose
  // document has not arrived yet is not a mode the editor can show, and treating
  // it as active would withhold the inline hint while showing no pane — a blank
  // half-screen where the source used to be.
  return {
    source,
    active: source !== undefined,
    onEnter: source === undefined ? translation?.onEnter : undefined,
    onExit: translation?.onExit,
  };
}
