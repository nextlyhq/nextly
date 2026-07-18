/**
 * LanguageStatusPills — the entry editor's translation-status overview (i18n M7, spec §10).
 *
 * Renders one pill per configured language showing, at a glance, whether that language is
 * translated and — for draft-enabled collections — its per-language publish state. This is the
 * "which languages are translated, missing, or draft" view users repeatedly ask for and that
 * Payload/Strapi lack. Clicking a pill switches the editor to that language.
 *
 * Data comes from the entry's `_translations` map (requested via `?translation-status=1`). Renders
 * nothing when localization is off or the map is absent, so non-localized editors are unchanged.
 *
 * @module components/features/entries/LanguageStatusPills
 */

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

/** Per-locale translation state, mirroring the backend `_translations` map. */
export interface LocaleTranslationMeta {
  translated: boolean;
  status?: string;
}

export interface LanguageStatusPillsProps {
  /** The entry's `_translations` map, keyed by locale code. */
  translations?: Record<string, LocaleTranslationMeta>;
  /** The active editing locale (undefined = the app default). */
  activeLocale?: string;
  /** Called when a pill is clicked to switch languages. */
  onSelect?: (code: string) => void;
  className?: string;
}

type PillState = "missing" | "draft" | "published" | "translated";

/** Resolve a locale's pill state from its translation meta. */
function pillState(meta: LocaleTranslationMeta | undefined): PillState {
  if (!meta || !meta.translated) return "missing";
  if (meta.status === "published") return "published";
  if (meta.status === "draft") return "draft";
  return "translated";
}

// Colour language matches DocumentPanel's status pills: published = solid foreground, draft =
// neutral muted, translated-without-status = subtle positive, missing = dashed/outline.
const PILL_CLASS: Record<PillState, string> = {
  missing:
    "border border-dashed border-primary/20 text-muted-foreground/70 bg-transparent",
  draft: "bg-muted text-muted-foreground border border-primary/10",
  translated:
    "bg-success-100 text-success-800 border border-success-200 dark:bg-success-950/40 dark:text-success-200 dark:border-success-900",
  published: "bg-foreground text-background",
};

const STATE_LABEL: Record<PillState, string> = {
  missing: "not translated",
  draft: "draft",
  translated: "translated",
  published: "published",
};

/**
 * LanguageStatusPills — per-language translation-status pills for the entry editor.
 */
export function LanguageStatusPills({
  translations,
  activeLocale,
  onSelect,
  className,
}: LanguageStatusPillsProps) {
  const { enabled, locales, defaultLocale } = useLocalization();

  // Non-localized apps, or before the status map has loaded → render nothing.
  if (!enabled || !translations) return null;

  const active = activeLocale ?? defaultLocale;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="group"
      aria-label="Translation status by language"
    >
      {locales.map(locale => {
        const state = pillState(translations[locale.code]);
        const isActive = locale.code === active;
        return (
          <button
            key={locale.code}
            type="button"
            onClick={() => onSelect?.(locale.code)}
            aria-pressed={isActive}
            aria-label={`${locale.label} — ${STATE_LABEL[state]}`}
            title={`${locale.label} — ${STATE_LABEL[state]}`}
            className={cn(
              "px-2 py-0.5 text-[11px] font-bold tracking-[0.06em] uppercase rounded transition-shadow",
              PILL_CLASS[state],
              isActive && "ring-2 ring-primary/60 ring-offset-1"
            )}
          >
            {locale.code}
          </button>
        );
      })}
    </div>
  );
}
