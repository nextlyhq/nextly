"use client";

/**
 * LanguageDots — one row's languages, at a glance and one click from open.
 *
 * The list previously answered "how far along is this row" with a single
 * `n/total` badge. That says how MUCH is left and never WHICH, so deciding what
 * to work on next meant opening rows to find out. One dot per language answers
 * both in the same width, and each dot is the way into that language.
 *
 * Dots use the same state vocabulary as the editor's language control and
 * panel, so a language reads identically wherever it is seen. State is never
 * colour alone: the dot's SHAPE differs per state and every dot carries the
 * language and its state in its accessible name.
 *
 * The DEFAULT language is deliberately absent. It is the source these are
 * translated from, not one of them, and a permanently-filled dot in every row
 * of the table is a column of noise.
 *
 * @module components/features/entries/EntryList/LanguageDots
 */

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import { StateDot } from "../LanguageControl";
import {
  LANGUAGE_STATE_LABEL,
  languageState,
  translationCounts,
  untranslatedLocales,
  type LocaleTranslationMeta,
} from "../translation-meta";

/**
 * How many dots a row shows before it summarises the rest.
 *
 * A table row is scanned, not read: past roughly half a dozen marks the row
 * stops being glanceable and the column starts setting the table's width. The
 * remainder is not lost — it is in the group's accessible name and in the
 * count beside the dots.
 */
const MAX_DOTS = 6;

export interface LanguageDotsProps {
  /** The row's `_translations` map, keyed by locale code. */
  translations?: Record<string, LocaleTranslationMeta>;
  /** Open this row in a given language. Absent renders plain dots, not buttons. */
  onOpenLocale?: (code: string) => void;
  className?: string;
}

export function LanguageDots({
  translations,
  onOpenLocale,
  className,
}: LanguageDotsProps) {
  const { enabled, locales, defaultLocale } = useLocalization();
  if (!enabled || locales.length < 2) return null;

  const translatable = locales.filter(l => l.code !== defaultLocale);
  const { translated, total } = translationCounts(
    translations,
    locales.map(l => l.code),
    defaultLocale
  );
  const missing = untranslatedLocales(translations, locales, defaultLocale);
  const shown = translatable.slice(0, MAX_DOTS);
  const overflow = translatable.length - shown.length;

  // One spoken summary for the whole group, so a reader gets the row's answer
  // without stepping through every dot — while each dot still names itself for
  // anyone who does.
  const summary =
    missing.length === 0
      ? `All ${total} languages translated`
      : `${translated} of ${total} languages translated; missing ${missing.join(", ")}`;

  return (
    <span
      role="group"
      aria-label={summary}
      className={cn("inline-flex items-center gap-1", className)}
    >
      {shown.map(locale => {
        const state = languageState(translations?.[locale.code]);
        const name = `${locale.label} — ${LANGUAGE_STATE_LABEL[state]}`;
        if (!onOpenLocale) {
          return (
            <span key={locale.code} title={name}>
              <StateDot state={state} />
            </span>
          );
        }
        return (
          <button
            key={locale.code}
            type="button"
            // Opening the row IN that language is the next step after noticing
            // it is missing, so the dot is the control rather than a decoration
            // beside one.
            onClick={e => {
              // The row itself navigates; this is a more specific destination.
              e.stopPropagation();
              onOpenLocale(locale.code);
            }}
            aria-label={`Open in ${name}`}
            title={`Open in ${name}`}
            className={cn(
              "inline-flex items-center justify-center rounded-xs p-0.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "hover:bg-muted"
            )}
          >
            <StateDot state={state} />
          </button>
        );
      })}
      {overflow > 0 && (
        <span
          aria-hidden="true"
          className="text-[10px] text-muted-foreground tabular-nums"
        >
          +{overflow}
        </span>
      )}
      {/* The number stays: with several languages the dots say which, and this
          says how far, without counting marks. `aria-hidden` because the group's
          own name above already states it in words. */}
      <span
        aria-hidden="true"
        className="ml-1 text-[11px] text-muted-foreground tabular-nums"
      >
        {translated}/{total}
      </span>
    </span>
  );
}
