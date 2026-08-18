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

import type { LocaleTranslationMeta } from "./translation-meta";

export type LanguageState = "missing" | "draft" | "translated" | "published";

/** Resolve a locale's display state from its translation meta. */
export function languageState(
  meta: LocaleTranslationMeta | undefined
): LanguageState {
  if (!meta || !meta.translated) return "missing";
  if (meta.status === "published") return "published";
  if (meta.status === "draft") return "draft";
  return "translated";
}

export const LANGUAGE_STATE_LABEL: Record<LanguageState, string> = {
  missing: "not translated",
  draft: "draft",
  translated: "translated",
  published: "published",
};

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
        state === "missing" && "border-[1.5px] border-muted-foreground/60"
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
