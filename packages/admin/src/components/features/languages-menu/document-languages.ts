/**
 * What an editor's Languages button needs beyond the languages themselves: where the default
 * language is edited, which row is the one on screen, and why none can be opened. Free of React.
 *
 * @module components/features/languages-menu/document-languages
 */

import { HISTORY_ADDRESS_PARAMS } from "@admin/components/features/versions/history-address";
import { LOCALE_PARAM, TRANSLATE_PARAM } from "@admin/constants/search-params";
import type { SearchParams } from "@admin/lib/search-params";

import type { LanguageOverview } from "./languages-menu-model";

/** What an editor's read of a document says about its languages. */
export interface DocumentLanguages {
  /** Absent where the person may not read every language's state, or none was asked for. */
  translations: Readonly<Record<string, LanguageOverview>> | undefined;
  /** The document's own status; undefined where it has no Draft / Published lifecycle. */
  documentStatus: string | undefined;
}

/** Reads a document's languages off it, as its editor read it. */
export function documentLanguagesOf(
  document: unknown,
  hasStatus: boolean
): DocumentLanguages {
  const read = (document ?? {}) as {
    _translations?: DocumentLanguages["translations"];
    status?: unknown;
  };
  return {
    translations: read._translations,
    documentStatus:
      hasStatus && typeof read.status === "string" ? read.status : undefined,
  };
}

/**
 * The editor's address in its default language.
 *
 * The language is named although it is the default: the editor's bare path, followed from the
 * same path with another language in its query, is taken for the page already on screen and
 * never left.
 */
export function editAddress(
  editorPath: string,
  defaultLanguage: string
): string {
  return `${editorPath}?${new URLSearchParams({ [LOCALE_PARAM]: defaultLanguage }).toString()}`;
}

/** What an address says of its own language, or of the version of it on screen. */
const LANGUAGE_KEYS: ReadonlySet<string> = new Set([
  LOCALE_PARAM,
  TRANSLATE_PARAM,
  ...HISTORY_ADDRESS_PARAMS,
]);

/**
 * A language's `address` with the rest of the query on screen kept: another language is opened on
 * the tab this one is open on.
 */
export function keepingQuery(address: string, onScreen: SearchParams): string {
  const [path, query = ""] = address.split("?");
  const kept = new URLSearchParams(query);
  for (const [key, value] of Object.entries(onScreen)) {
    if (LANGUAGE_KEYS.has(key)) continue;
    for (const each of [value].flat()) {
      if (each !== undefined) kept.append(key, each);
    }
  }
  return `${path}?${kept.toString()}`;
}

/**
 * The language whose row says it is being edited, or undefined where none does.
 *
 * A translation open on its own, with no source beside it, is not yet being translated: its row
 * still offers Translate.
 */
export function currentLanguageOf(args: {
  /** The language on screen; undefined is the default one. */
  locale: string | undefined;
  defaultLanguage: string;
  translating: boolean;
}): string | undefined {
  const onScreen = args.locale ?? args.defaultLanguage;
  return onScreen === args.defaultLanguage || args.translating
    ? onScreen
    : undefined;
}

/** What holds the language on screen, so no other can be opened in its place. */
export interface LanguagesHold {
  /** A past version is on screen, which is one language's. */
  viewingPastVersion: boolean;
  /** Live values are being taken after a refused publish. */
  recovering: boolean;
  /** A change made elsewhere waits for the author's answer about this language's edits. */
  changeAwaiting: boolean;
  /**
   * The document can't be edited here now by a person who otherwise could: someone else has it, or
   * its latest version isn't loaded. A reader, who edits nothing, is never held by this.
   */
  documentHeld: boolean;
}

/** Why no other language can be opened now, or undefined where one can. */
export function languagesHeldReason(hold: LanguagesHold): string | undefined {
  if (hold.viewingPastVersion) {
    return "You are viewing a past version. Return to the current one to open another language.";
  }
  if (hold.recovering) {
    return "The live values are still being taken. Switch languages once they're in.";
  }
  if (hold.changeAwaiting) {
    return "This document changed elsewhere. Answer that above before you switch languages.";
  }
  if (hold.documentHeld) {
    return "You can switch languages once this document can be edited here.";
  }
  return undefined;
}
