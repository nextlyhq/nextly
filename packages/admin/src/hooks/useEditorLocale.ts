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

import { LOCALE_PARAM } from "@admin/constants/search-params";
import { useLocaleParam } from "@admin/hooks/useLocaleParam";
import { setSearchParam } from "@admin/lib/navigation";

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
  // Only a CONFIGURED language is honoured, and translation mode's source param
  // owes the same rule — see `useLocaleParam`, which is where it lives so the
  // two cannot come to disagree.
  const locale = useLocaleParam(LOCALE_PARAM);

  // The seed stays in component state deliberately. It is a one-shot intent
  // consumed on arrival, not a property of the page: in the URL it would
  // survive a reload and re-offer a copy the author asked for once, and it
  // would be carried into any link they shared.
  //
  // It records the TARGET as well as the source, and that pair is what makes it
  // survive an interrupted switch. Asking for the URL change does not perform
  // it: on a dirty form `UnsavedChangesGuard` holds the navigation until the
  // author answers, and through that whole wait the language being edited is
  // still the SOURCE. A seed stored as a bare source is indistinguishable from
  // "copy this language onto itself" during that window, and the consumer
  // rightly discards it — so the copy the author was promised never arrived
  // once they chose "Discard changes".
  const [seed, setSeed] = useState<
    { target: string; from: string } | undefined
  >(undefined);

  // Set together, deliberately: a switch either carries a seed or clears the
  // previous one. Leaving a stale seed behind would re-offer a copy the author
  // asked for two languages ago.
  const changeLocale = useCallback(
    (code: string, options?: { seedFrom?: string }) => {
      setSeed(
        options?.seedFrom === undefined
          ? undefined
          : { target: code, from: options.seedFrom }
      );
      setSearchParam(LOCALE_PARAM, code);
    },
    []
  );

  // Offered only once the switch has LANDED. An abandoned navigation leaves the
  // pair in state where it is invisible and harmless, replaced by the next
  // switch; and because the target is the language now being edited, the source
  // can never equal it, so the consumer's self-copy guard is a safety net
  // rather than the thing that swallows the intent.
  const seedFromLocale =
    seed !== undefined && seed.target === locale ? seed.from : undefined;

  // Drops the seed too: a pending copy names a target language that is no
  // longer the one being edited.
  const resetLocale = useCallback(() => {
    setSeed(undefined);
    setSearchParam(LOCALE_PARAM, null);
  }, []);

  const clearSeed = useCallback(() => setSeed(undefined), []);

  return { locale, changeLocale, resetLocale, seedFromLocale, clearSeed };
}
