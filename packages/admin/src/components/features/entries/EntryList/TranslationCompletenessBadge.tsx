/**
 * TranslationCompletenessBadge — the list-view half of the translation-status overview (i18n M7,
 * spec §10). Summarises, for one entry row, how many configured languages are translated as a
 * compact "n/total" badge, coloured by completeness. This is the at-a-glance "which entries still
 * need translating" view that Payload/Strapi lack.
 *
 * Reads the row's `_translations` map (requested via `?translation-status=1`). Renders a dash when
 * localization is off or the map is absent, so non-localized tables are unchanged.
 *
 * @module components/features/entries/EntryList/TranslationCompletenessBadge
 */

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

interface LocaleTranslationMeta {
  translated: boolean;
  status?: string;
}

export interface TranslationCompletenessBadgeProps {
  translations?: Record<string, LocaleTranslationMeta>;
}

/**
 * TranslationCompletenessBadge — per-row "n/total languages translated" badge.
 */
export function TranslationCompletenessBadge({
  translations,
}: TranslationCompletenessBadgeProps) {
  const { enabled, locales } = useLocalization();

  if (!enabled || !translations || locales.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const total = locales.length;
  const translated = locales.reduce(
    (n, l) => (translations[l.code]?.translated ? n + 1 : n),
    0
  );

  const complete = translated >= total;
  const missing = locales
    .filter(l => !translations[l.code]?.translated)
    .map(l => l.label);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold tracking-[0.06em] rounded tabular-nums",
        complete
          ? "bg-success-100 text-success-800 border border-success-200 dark:bg-success-950/40 dark:text-success-200 dark:border-success-900"
          : "bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-950/40 dark:text-warning-200 dark:border-warning-900"
      )}
      title={
        complete ? "All languages translated" : `Missing: ${missing.join(", ")}`
      }
      aria-label={
        complete
          ? "All languages translated"
          : `${translated} of ${total} languages translated; missing ${missing.join(", ")}`
      }
    >
      {translated}/{total}
    </span>
  );
}
