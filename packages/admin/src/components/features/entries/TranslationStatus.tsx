"use client";

/**
 * TranslationStatus — the entry header's single translation instrument.
 *
 * Three separate controls used to describe the same underlying fact in three
 * places: a language switcher, a row of per-language pills, and a completeness
 * badge in the list view. Read together they answer one question in three
 * fragments — where am I, what state is everywhere else in, and how far along
 * is the document as a whole — so they are presented as one strip: a
 * completeness bar, then one pill per language.
 *
 * The pills themselves stay in `LanguageStatusPills`; this composes that rather
 * than restating it, so there is one implementation of what a language's state
 * looks like.
 *
 * @module components/features/entries/TranslationStatus
 */

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import {
  LanguageStatusPills,
  type LocaleTranslationMeta,
} from "./LanguageStatusPills";

export interface TranslationCounts {
  /** Languages carrying a translation, whatever its publish state. */
  translated: number;
  /** Of those, how many are published. */
  published: number;
  /** Languages configured for the app. */
  total: number;
}

/**
 * How far along the document's translations are.
 *
 * Exported and used by every caller that needs these numbers — the bar below,
 * and the header's spoken status region. Two places counting "how many
 * languages are translated" from the same map would agree on the day they were
 * written and drift silently afterwards.
 */
export function translationCounts(
  translations: Record<string, LocaleTranslationMeta> | undefined,
  localeCodes: readonly string[]
): TranslationCounts {
  let translated = 0;
  let published = 0;
  for (const code of localeCodes) {
    const meta = translations?.[code];
    if (!meta?.translated) continue;
    translated += 1;
    if (meta.status === "published") published += 1;
  }
  return { translated, published, total: localeCodes.length };
}

export interface TranslationStatusProps {
  /** The entry's `_translations` map, keyed by locale code. */
  translations?: Record<string, LocaleTranslationMeta>;
  /** The active editing locale (undefined = the app default). */
  activeLocale?: string;
  /** Called when a language is chosen. */
  onSelect?: (code: string) => void;
  className?: string;
}

/**
 * The completeness bar: published languages, then merely-translated ones, then
 * the remainder as untouched track.
 *
 * `aria-hidden` because the same numbers are already announced by the header's
 * status region and written beside the bar in text. A second accessible copy
 * would have a reader hear the progress twice.
 */
function CompletenessBar({ counts }: { counts: TranslationCounts }) {
  if (counts.total === 0) return null;
  const pct = (n: number) => `${(n / counts.total) * 100}%`;
  const partial = Math.max(counts.translated - counts.published, 0);
  return (
    <div
      aria-hidden="true"
      className="flex h-1.5 w-24 overflow-hidden rounded-sm bg-muted"
    >
      <span
        className="block bg-foreground"
        style={{ width: pct(counts.published) }}
      />
      <span
        className="block bg-muted-foreground/50"
        style={{ width: pct(partial) }}
      />
    </div>
  );
}

/**
 * TranslationStatus — completeness bar plus per-language pills, as one control.
 *
 * Renders nothing when localization is off or the status map has not loaded, so
 * a non-localized editor is visually unchanged.
 */
export function TranslationStatus({
  translations,
  activeLocale,
  onSelect,
  className,
}: TranslationStatusProps) {
  const { enabled, locales } = useLocalization();

  // Nothing to report: not a multilingual app, or the entry was not fetched
  // with `?translation-status=1`.
  if (!enabled || !translations || locales.length === 0) return null;

  const counts = translationCounts(
    translations,
    locales.map(l => l.code)
  );

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <CompletenessBar counts={counts} />
      {/* Written out rather than left to the bar alone: a bar is a comparison,
          and the reader wants the number. */}
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {counts.translated} of {counts.total}
      </span>
      <LanguageStatusPills
        translations={translations}
        {...(activeLocale === undefined ? {} : { activeLocale })}
        {...(onSelect === undefined ? {} : { onSelect })}
      />
    </div>
  );
}
