"use client";

/**
 * useTranslationMode — whether the editor is showing a source language beside
 * the one being edited, and which language that is.
 *
 * In the URL, alongside `?locale=`, for the reasons that put the language there
 * (#1027): the pair is linkable, survives a reload, and is reachable with the
 * back button. Entering and leaving the mode is then a NAVIGATION, which is what
 * lets the unsaved-changes guard see it — and the guard already compares search
 * as well as pathname, so it does not need teaching.
 *
 * Deliberately NOT folded into `useEditorLocale`. That hook exists to hold the
 * active language and its one-shot seed together, because they cannot be held
 * apart; a view mode is a third thing, wanted by fewer callers, and adding it
 * there would make every consumer of the language re-render when the mode
 * changes.
 *
 * @module hooks/useTranslationMode
 */

import { useCallback } from "react";

import { TRANSLATE_PARAM } from "@admin/constants/search-params";
import { useLocaleParam } from "@admin/hooks/useLocaleParam";
import { setSearchParam } from "@admin/lib/navigation";

export interface TranslationMode {
  /**
   * The language being translated FROM, or undefined when the mode is off.
   *
   * Undefined covers four cases that are all "no source to show", and none of
   * them is worth surfacing to the reader: the param is absent, it names a
   * language the app does not configure, it names the language already being
   * edited, or the app has no localization at all.
   */
  translateFrom: string | undefined;
  /** Show `source` beside the language being edited. */
  enterTranslationMode: (source: string) => void;
  /** Return to the ordinary single-pane editor, keeping the active language. */
  exitTranslationMode: () => void;
}

export function useTranslationMode({
  activeLocale,
  defaultLocale,
}: {
  /** The language being edited. `undefined` = the app default. */
  activeLocale: string | undefined;
  /** The app default, which is what `undefined` above resolves to. */
  defaultLocale: string | undefined;
}): TranslationMode {
  const requested = useLocaleParam(TRANSLATE_PARAM);

  // A source that IS the target is not a source. It arises from an ordinary
  // action — entering the mode and then switching the target to the language you
  // were translating from — so it has to resolve to "mode off" rather than to a
  // pane showing the document beside itself. Resolved through `defaultLocale`
  // because an absent `?locale=` means the default, so `?locale=` unset with
  // `?translate=en` on an English-default app is the same collision spelled
  // differently.
  const target = activeLocale ?? defaultLocale;
  const translateFrom =
    requested !== undefined && requested !== target ? requested : undefined;

  const enterTranslationMode = useCallback((source: string) => {
    setSearchParam(TRANSLATE_PARAM, source);
  }, []);

  const exitTranslationMode = useCallback(() => {
    setSearchParam(TRANSLATE_PARAM, null);
  }, []);

  return { translateFrom, enterTranslationMode, exitTranslationMode };
}
