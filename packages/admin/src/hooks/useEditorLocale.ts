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
 * @module hooks/useEditorLocale
 */

import { useCallback, useState } from "react";

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
  const [locale, setLocale] = useState<string | undefined>(undefined);
  const [seedFromLocale, setSeedFromLocale] = useState<string | undefined>(
    undefined
  );

  // Set together, deliberately: a switch either carries a seed or clears the
  // previous one. Leaving a stale seed behind would re-offer a copy the author
  // asked for two languages ago.
  const changeLocale = useCallback(
    (code: string, options?: { seedFrom?: string }) => {
      setLocale(code);
      setSeedFromLocale(options?.seedFrom);
    },
    []
  );

  // Drops the seed too: a pending copy names a target language that is no
  // longer the one being edited.
  const resetLocale = useCallback(() => {
    setLocale(undefined);
    setSeedFromLocale(undefined);
  }, []);

  const clearSeed = useCallback(() => setSeedFromLocale(undefined), []);

  return { locale, changeLocale, resetLocale, seedFromLocale, clearSeed };
}
