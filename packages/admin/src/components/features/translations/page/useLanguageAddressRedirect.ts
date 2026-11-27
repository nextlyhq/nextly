"use client";

/**
 * Sends an editor address that names a language on to where that language is
 * written: the translation page, or the editor itself for the default one.
 *
 * Links made before translation had a page of its own name a language on the
 * editor (`?locale=`, `?translate=`), as does the editor's own language panel,
 * so the editor answers them by moving rather than by editing that language.
 *
 * @module components/features/translations/page/useLanguageAddressRedirect
 */

import { useEffect, useState } from "react";

import { LOCALE_PARAM, TRANSLATE_PARAM } from "@admin/constants/search-params";
import { useLocalization } from "@admin/hooks/useLocalization";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { navigateWithinAdmin, setSearchParams } from "@admin/lib/navigation";
import {
  languageAddressMove,
  translationAddress,
  type LanguageAddressMove,
  type TranslatedDocument,
} from "@admin/lib/navigation/translation-address";
import type { SearchParams } from "@admin/lib/search-params";
import { getSearchParam } from "@admin/lib/search-params";

import { HISTORY_PARAM } from "../../versions/history-address";

/** What the editor page knows of the document its address opens. */
export interface LanguageAddressOf {
  /** The document, or undefined while the address names none. */
  document: TranslatedDocument | undefined;
  /** Whether the collection or Single keeps its text per language. */
  localized: boolean;
  /** The document view on screen, which the editor's page also answers. */
  view: string | undefined;
  /**
   * The language a copy was asked to start from. The editor copies the values
   * into its own form, so a copy under way stays on the editor.
   */
  copyingFrom: string | undefined;
}

/**
 * Whether the address opens the history panel, which the editor alone shows:
 * a version of another language is compared and restored there.
 */
function opensHistory(params: SearchParams): boolean {
  return getSearchParam(params, HISTORY_PARAM) === "1";
}

/** The address's query as the move reads it: the first of a repeated key. */
function languageQuery(params: SearchParams): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of [LOCALE_PARAM, TRANSLATE_PARAM]) {
    const value = getSearchParam(params, key);
    if (value !== null) query.set(key, value);
  }
  return query;
}

/**
 * Make the move in place of the current entry, so Back does not land on the
 * old address and move again. The editor is the same path with the keys taken
 * away, which is a change of query and not a navigation.
 */
function makeMove(
  document: TranslatedDocument,
  move: LanguageAddressMove
): void {
  if (move.to === "editor") {
    setSearchParams(
      { [LOCALE_PARAM]: null, [TRANSLATE_PARAM]: null },
      { replace: true }
    );
    return;
  }
  navigateWithinAdmin(translationAddress(document, move.pair), {
    replace: true,
  });
}

/**
 * Move an address naming a language on, when the site has languages and the
 * document keeps its text in them. The languages are unknown until the admin's
 * startup answer arrives, and a document view at the same address is its own
 * screen; neither moves.
 */
export function useLanguageAddressRedirect({
  document,
  localized,
  view,
  copyingFrom,
}: LanguageAddressOf): void {
  const params = useSearchParams();
  const { enabled, locales, defaultLocale } = useLocalization();
  const locale = getSearchParam(params, LOCALE_PARAM);

  // The language a copy was asked for, kept for as long as that language is
  // open: the editor clears the request once it has offered it, while the
  // copied values are still unsaved in its form.
  const [copied, setCopied] = useState<string | null>(null);
  const copyingIn =
    copyingFrom !== undefined || copied === locale ? locale : null;
  if (copyingIn !== copied) setCopied(copyingIn);

  const answers = enabled && localized && view === undefined;
  const move =
    !answers || copyingIn !== null || opensHistory(params)
      ? undefined
      : languageAddressMove(languageQuery(params), { locales, defaultLocale });

  // By its contents: the document and the move are new objects each render.
  const key =
    move === undefined || document === undefined
      ? undefined
      : JSON.stringify([document, move]);
  useEffect(() => {
    if (key === undefined) return;
    const [to, next] = JSON.parse(key) as [
      TranslatedDocument,
      LanguageAddressMove,
    ];
    makeMove(to, next);
  }, [key]);
}
