"use client";

/**
 * useEditorLocale — the active content language of a document editor, and any
 * seed the last switch asked for.
 *
 * The two belong together and cannot be held apart. Switching language refetches
 * the document, which tears the editor's subtree down; so "open German, and
 * start it from English" cannot be recorded inside that subtree — the intent is
 * destroyed before anything can act on it. It has to live wherever `locale`
 * lives, above the teardown, and travel with the switch that caused it.
 *
 * The entry editor and the single editor both own this state and owned it
 * identically. Two copies of a rule this subtle would agree the day they were
 * written and drift silently, and the drift would show up as a button that
 * quietly does nothing.
 *
 * The language lives in the URL rather than in component state, which makes it
 * three things it was not: linkable (a colleague can be sent the German copy),
 * durable across a reload, and reachable with the back button. It also makes a
 * switch a NAVIGATION, which is what lets the unsaved-changes guard see it —
 * changing language refetches the document and discards unsaved edits, and as
 * pure state that happened without anything being able to ask first.
 *
 * @module hooks/useEditorLocale
 */

import { useCallback, useState } from "react";

import { useLocalization } from "@admin/hooks/useLocalization";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { setSearchParam } from "@admin/lib/navigation";
import { getSearchParam } from "@admin/lib/routing";

/** The query key the editor's content language is addressed by. */
export const LOCALE_PARAM = "locale";

export interface EditorLocale {
  /** Active content language. `undefined` = the app default, resolved by the backend. */
  locale: string | undefined;
  /**
   * Switch language. `seedFrom` asks that the newly active language be seeded
   * from the named one once the switch lands.
   */
  changeLocale: (code: string, options?: { seedFrom?: string }) => void;
  /**
   * Return to the app default. Distinct from `changeLocale`, which names a
   * language: the default is the ABSENCE of a choice, and it doubles as the
   * retry after a failed per-language read, since it re-keys the query.
   */
  resetLocale: () => void;
  /** The seed the last switch asked for, or undefined. */
  seedFromLocale: string | undefined;
  /** Clears the seed once the editor has offered it. */
  clearSeed: () => void;
}

export function useEditorLocale(): EditorLocale {
  const searchParams = useSearchParams();
  const { locales } = useLocalization();

  // Only a CONFIGURED language is honoured. A hand-edited or stale `?locale=`
  // would otherwise be sent to the API, which answers for a language the app
  // does not have — so an unknown one reads as the default rather than as an
  // error the reader cannot act on.
  const requested = getSearchParam(searchParams, LOCALE_PARAM);
  const locale =
    requested && locales.some(l => l.code === requested)
      ? requested
      : undefined;

  // The seed stays in component state deliberately. It is a one-shot intent
  // consumed on arrival, not a property of the page: in the URL it would
  // survive a reload and re-offer a copy the author asked for once, and it
  // would be carried into any link they shared.
  const [seedFromLocale, setSeedFromLocale] = useState<string | undefined>(
    undefined
  );

  // Set together, deliberately: a switch either carries a seed or clears the
  // previous one. Leaving a stale seed behind would re-offer a copy the author
  // asked for two languages ago.
  const changeLocale = useCallback(
    (code: string, options?: { seedFrom?: string }) => {
      setSeedFromLocale(options?.seedFrom);
      setSearchParam(LOCALE_PARAM, code);
    },
    []
  );

  // Drops the seed too: a pending copy names a target language that is no
  // longer the one being edited.
  const resetLocale = useCallback(() => {
    setSeedFromLocale(undefined);
    setSearchParam(LOCALE_PARAM, null);
  }, []);

  const clearSeed = useCallback(() => setSeedFromLocale(undefined), []);

  return { locale, changeLocale, resetLocale, seedFromLocale, clearSeed };
}
