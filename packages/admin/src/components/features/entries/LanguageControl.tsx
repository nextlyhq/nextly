"use client";

/**
 * LanguageControl — one control that answers "which language am I editing" and
 * "what state is every language in", together.
 *
 * The header previously answered those with two adjacent controls: a dropdown
 * that switched and a row of pills that showed state (and also switched). One
 * question, two affordances. This is a single segmented control: each segment
 * is a language, its dot is that language's state, and pressing it switches.
 *
 * State is never colour alone. Each dot's SHAPE differs per state (filled /
 * half-filled / outline), the segment carries the language's label as text,
 * and the accessible name spells the state out.
 *
 * Renders nothing when localization is off or a change handler is not wired,
 * so non-localized editors are unchanged.
 *
 * @module components/features/entries/LanguageControl
 */

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import {
  LANGUAGE_STATE_LABEL,
  languageState,
  type LanguageState,
  type LocaleTranslationMeta,
} from "./translation-meta";

// The vocabulary itself lives in `translation-meta`, with the rest of what can
// be read off a `_translations` map. Re-exported here because this file was its
// home while the control was its only reader, and several surfaces import it
// from here.
export { LANGUAGE_STATE_LABEL, languageState };
export type { LanguageState };

/**
 * The dot encodes state by shape first: filled (published), filled in the
 * positive scale (translated), half-filled (draft), outline (missing). Colour
 * comes from the semantic scales only.
 */
export function StateDot({ state }: { state: LanguageState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        state === "published" && "bg-foreground",
        state === "translated" && "bg-success-600 dark:bg-success-400",
        state === "draft" &&
          "border-[1.5px] border-foreground/70 [background:linear-gradient(90deg,currentColor_50%,transparent_50%)] text-foreground/70",
        // Full strength rather than an alpha: the outline is the only thing
        // that renders this dot, so it is a UI boundary held to 3:1. At /60 it
        // measured 2.87:1 on the page surface; the token itself reaches 7.55:1
        // and stays quieter than the draft dot above it.
        state === "missing" && "border-[1.5px] border-muted-foreground"
      )}
    />
  );
}

export interface LanguageControlProps {
  /** The entry's `_translations` map, keyed by locale code. Absent → all dots read "missing". */
  translations?: Record<string, LocaleTranslationMeta>;
  /** The active editing locale (undefined = the app default). */
  activeLocale?: string;
  /** Called with the newly selected locale code. */
  onSelect: (code: string) => void;
  /**
   * Disables switching (e.g. while a past version is on screen, where changing
   * the document under the history banner would be disorienting). The states
   * stay readable; only the interaction is withheld.
   */
  disabled?: boolean;
  className?: string;
}

export function LanguageControl({
  translations,
  activeLocale,
  onSelect,
  disabled = false,
  className,
}: LanguageControlProps) {
  const { enabled, locales, defaultLocale } = useLocalization();
  if (!enabled || locales.length < 2) return null;

  const active = activeLocale ?? defaultLocale;

  return (
    <div
      role="group"
      aria-label="Content language"
      className={cn(
        "inline-flex items-stretch rounded-md border border-border overflow-hidden",
        className
      )}
    >
      {locales.map((locale, index) => {
        const state = languageState(translations?.[locale.code]);
        const isActive = locale.code === active;
        return (
          <button
            key={locale.code}
            type="button"
            onClick={() => onSelect(locale.code)}
            disabled={disabled}
            aria-pressed={isActive}
            aria-label={`${locale.label} — ${LANGUAGE_STATE_LABEL[state]}${
              locale.code === defaultLocale ? " (default)" : ""
            }`}
            title={`${locale.label} — ${LANGUAGE_STATE_LABEL[state]}`}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              index > 0 && "border-l border-border",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-60 cursor-default"
            )}
          >
            <StateDot state={state} />
            {locale.label}
          </button>
        );
      })}
    </div>
  );
}
