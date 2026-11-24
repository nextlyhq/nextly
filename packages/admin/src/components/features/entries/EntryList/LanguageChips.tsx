"use client";

/**
 * LanguageChips: one row's languages in the entry list, each a labelled chip, and the key that
 * says what each chip means.
 *
 * Each chip names its language by code and draws its state three ways at once: a mark whose
 * SHAPE differs per state (circle, diamond, triangle, half circle, ring), the chip's surface
 * (amber only for the two states that ask for work, a dashed edge for a missing language), and
 * the state in words in its accessible name. Colour is never the only signal, and only states
 * are coloured.
 *
 * Nothing renders below two languages: a one-language site has no languages to compare, so
 * neither the chips nor the key appear.
 *
 * @module components/features/entries/EntryList/LanguageChips
 */

import { useId, useState, type JSX, type ReactNode } from "react";

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import {
  translationCounts,
  untranslatedLocales,
  type LocaleTranslationMeta,
} from "../translation-meta";

import {
  LANGUAGE_CHIP_MEANING,
  LANGUAGE_CHIP_STATES,
  LANGUAGE_CHIP_WORD,
  languageChipFacts,
  languageChipSpoken,
  type LanguageChipState,
} from "./language-chips";

/**
 * How many chips a row shows before the rest wait behind a "+N" control. A row is scanned, not
 * read: past a handful of chips the column sets the table's width. The control shows the rest,
 * each named and opened as the first ones are.
 */
const MAX_CHIPS = 6;

/** Each state's mark: a shape of its own, drawn in the chip's text colour. */
const MARK_CLASS: Record<LanguageChipState, string> = {
  live: "size-2 rounded-full bg-current",
  changes: "size-[7px] rotate-45 rounded-[1px] bg-current",
  outOfDate: "size-2 bg-current [clip-path:polygon(50%_0,100%_100%,0_100%)]",
  draft:
    "size-2 rounded-full border-[1.5px] border-current [background:linear-gradient(90deg,currentColor_50%,transparent_50%)]",
  missing: "size-2 rounded-full border-[1.5px] border-current",
};

/**
 * Each state's surface. Amber is the admin's colour for "changed", so it marks the two states
 * that ask for work; a missing language is drawn dashed and muted, as something not there yet.
 * The semantic tokens are defined for light and dark alike.
 */
const SURFACE_CLASS: Record<LanguageChipState, string> = {
  live: "border-border bg-card text-foreground",
  changes: "border-warning-border bg-warning-surface text-warning-text",
  outOfDate: "border-warning-border bg-warning-surface text-warning-text",
  draft: "border-border bg-card text-foreground",
  missing: "border-dashed border-muted-foreground text-muted-foreground",
};

/** A chip's face: its state's mark and surface around `children`. Shared by a row and the key. */
function LanguageChipFace({
  state,
  children,
  className,
}: {
  state: LanguageChipState;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      data-chip-state={state}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-semibold leading-none",
        SURFACE_CLASS[state],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block shrink-0", MARK_CLASS[state])}
      />
      {children}
    </span>
  );
}

export interface LanguageChipsProps {
  /** The row's `_translations` map, keyed by language code. */
  translations?: Record<string, LocaleTranslationMeta>;
  /**
   * The document's own Draft / Published status, for a collection with that lifecycle; every
   * language follows it where the collection keeps no status per language.
   */
  documentStatus?: unknown;
  /** Open this row in a given language. Absent renders plain chips, not buttons. */
  onOpenLocale?: (code: string) => void;
  className?: string;
}

/** One row's languages as chips, every configured language in order, the default included. */
export function LanguageChips({
  translations,
  documentStatus,
  onOpenLocale,
  className,
}: LanguageChipsProps): JSX.Element | null {
  const { enabled, locales = [] } = useLocalization();
  // Whether the chips past the first few are shown, after the reader asked for them.
  const [showsAll, setShowsAll] = useState(false);
  if (!enabled || locales.length < 2) return null;

  // The group's name answers for the whole row, every language included, so the chips a long
  // list does not draw are still accounted for.
  const { translated, total } = translationCounts(
    translations,
    locales.map(l => l.code)
  );
  const missing = untranslatedLocales(translations, locales);
  const summary =
    missing.length === 0
      ? `All ${total} languages translated`
      : `${translated} of ${total} languages translated; missing ${missing.join(", ")}`;
  // The languages past the first few, which wait behind the control at the row's end.
  const beyond = Math.max(0, locales.length - MAX_CHIPS);
  const shown = showsAll ? locales : locales.slice(0, MAX_CHIPS);

  return (
    <span
      role="group"
      aria-label={summary}
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
    >
      {shown.map(locale => {
        const facts = languageChipFacts(
          translations?.[locale.code],
          documentStatus
        );
        // The code the chip shows is part of its name, so a reader who says
        // what they see ("ES") reaches the control by voice. Set off by commas,
        // not parentheses, which a name check reads past.
        const name = `${locale.label}, ${locale.code.toUpperCase()}, ${languageChipSpoken(facts)}`;
        const face = (
          <LanguageChipFace state={facts.state} className="uppercase">
            {locale.code}
          </LanguageChipFace>
        );
        if (!onOpenLocale) {
          return (
            <span key={locale.code} title={name}>
              <span aria-hidden="true">{face}</span>
              <span className="sr-only">{name}</span>
            </span>
          );
        }
        return (
          <button
            key={locale.code}
            type="button"
            // The chip is the way into that language: noticing it needs work and opening it are
            // one step.
            onClick={event => {
              // The row itself navigates; this is a more specific destination.
              event.stopPropagation();
              onOpenLocale(locale.code);
            }}
            aria-label={`Open in ${name}`}
            title={`Open in ${name}`}
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {face}
          </button>
        );
      })}
      {beyond > 0 && (
        // The rest of the languages, one press away: each then has a chip of its own, with its
        // state and its way in, rather than a count nobody can open. The name holds the words
        // shown, so the control is reached by what it says.
        <button
          type="button"
          aria-expanded={showsAll}
          aria-label={
            showsAll
              ? "Fewer languages"
              : `Show ${beyond} more ${beyond === 1 ? "language" : "languages"}`
          }
          onClick={event => {
            // The row itself navigates; this only shows more or less of it.
            event.stopPropagation();
            setShowsAll(all => !all);
          }}
          className="inline-flex h-5 items-center rounded-sm px-1 text-[11px] text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {showsAll ? "Fewer" : `+${beyond}`}
        </button>
      )}
    </span>
  );
}

/**
 * The key to the chips, above the list: each state's chip with its word, and what it means for
 * a reader who cannot hover. Renders nothing below two languages, as the chips do.
 */
export function LanguageChipKey({
  className,
}: {
  className?: string;
}): JSX.Element | null {
  const keyId = useId();
  const { enabled, locales = [] } = useLocalization();
  if (!enabled || locales.length < 2) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground",
        className
      )}
    >
      <span id={keyId} className="font-medium">
        Language key
      </span>
      <ul
        aria-labelledby={keyId}
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
      >
        {LANGUAGE_CHIP_STATES.map(state => (
          <li key={state} title={LANGUAGE_CHIP_MEANING[state]}>
            <LanguageChipFace state={state}>
              {LANGUAGE_CHIP_WORD[state]}
            </LanguageChipFace>
            <span className="sr-only">: {LANGUAGE_CHIP_MEANING[state]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
