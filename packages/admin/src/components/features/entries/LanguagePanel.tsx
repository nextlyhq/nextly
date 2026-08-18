"use client";

/**
 * LanguagePanel — the document's language workflow in one place.
 *
 * Language state previously had no home: which language is active came from a
 * header control, what state the others were in came from a second control
 * beside it, and the actions lived in the document rail, which hides at
 * narrower widths. Each answered part of one question from a different place.
 *
 * This is that question's home — one row per language carrying its state, and
 * the action that row makes sense of: seed an untranslated language from
 * another, or open one that already has content. It renders in the rail where
 * there is room and inline where there is not, so it can never be the surface
 * that disappeared.
 *
 * The header keeps its compact switcher. This does not replace quick
 * switching; it is where the work is decided rather than where a language is
 * picked.
 *
 * Renders nothing when localization is off or fewer than two languages are
 * configured, so non-localized editors are unchanged.
 *
 * @module components/features/entries/LanguagePanel
 */

import { Button } from "@nextlyhq/ui";

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import { CopyFromLanguageDialog } from "./CopyFromLanguageDialog";
import {
  languageState,
  LANGUAGE_STATE_LABEL,
  StateDot,
  type LanguageState,
} from "./LanguageControl";
import type { LocaleTranslationMeta } from "./LanguageStatusPills";
import { translationCounts } from "./TranslationStatus";
import { useCopyFromLanguage } from "./useCopyFromLanguage";
import { usePublishAllLanguages } from "./usePublishAllLanguages";

export interface LanguagePanelProps {
  /** The entry's `_translations` map, keyed by locale code. */
  translations?: Record<string, LocaleTranslationMeta>;
  /** The active editing locale (undefined = the app default). */
  activeLocale?: string;
  /** Switch the editor to a language. */
  onSelect?: (code: string) => void;
  /** Whether the collection has the Draft/Published lifecycle. */
  hasStatus?: boolean;
  /**
   * Withholds every mutating action (reading a past version: nothing here may
   * write the live document). States stay readable.
   */
  actionsDisabled?: boolean;
  className?: string;
}

/**
 * The completeness meter. `aria-hidden` because the count beside it states the
 * same fact in words — a reader would otherwise hear the progress twice.
 */
function CompletenessMeter({
  translated,
  total,
}: {
  translated: number;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-1.5 w-16 overflow-hidden rounded-sm bg-muted"
    >
      <span
        className="block bg-foreground"
        style={{ width: `${(translated / total) * 100}%` }}
      />
    </span>
  );
}

function LanguageRow({
  code,
  label,
  rtl,
  isDefault,
  state,
  isActive,
  canSeed,
  onSelect,
  onSeed,
  actionsDisabled,
}: {
  code: string;
  label: string;
  rtl: boolean;
  isDefault: boolean;
  state: LanguageState;
  isActive: boolean;
  canSeed: boolean;
  onSelect?: (code: string) => void;
  onSeed?: () => void;
  actionsDisabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0">
      <StateDot state={state} />
      <span className="text-sm font-medium">{label}</span>
      {isDefault && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          default
        </span>
      )}
      {rtl && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          rtl
        </span>
      )}
      <span className="text-xs text-muted-foreground">
        {LANGUAGE_STATE_LABEL[state]}
      </span>
      <span className="flex-1" />
      {isActive ? (
        <span className="text-xs text-muted-foreground">editing now</span>
      ) : (
        <>
          {/* Offered only where it is the useful next step: a language with
              nothing in it. Seeding one that already has content is the
              overwrite the confirm step exists to warn about, and it stays
              available from the Languages menu for that case. */}
          {canSeed && state === "missing" && onSeed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={actionsDisabled}
              onClick={onSeed}
            >
              Start from…
            </Button>
          )}
          {onSelect && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onSelect(code)}
            >
              Open
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function LanguagePanel({
  translations,
  activeLocale,
  onSelect,
  hasStatus,
  actionsDisabled = false,
  className,
}: LanguagePanelProps) {
  const { enabled, locales, defaultLocale } = useLocalization();
  const copy = useCopyFromLanguage();
  const publish = usePublishAllLanguages(
    hasStatus === undefined ? {} : { hasStatus }
  );

  if (!enabled || locales.length < 2) return null;

  const active = activeLocale ?? defaultLocale;
  const counts = translationCounts(
    translations,
    locales.map(l => l.code)
  );

  return (
    <div className={cn("rounded-md border border-border", className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Languages
        </span>
        <CompletenessMeter
          translated={counts.translated}
          total={counts.total}
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {counts.translated} of {counts.total} translated
        </span>
        <span className="flex-1" />
        {publish.available && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={actionsDisabled || publish.pending}
            onClick={publish.publishAll}
          >
            {publish.pending ? "Publishing…" : "Publish all"}
          </Button>
        )}
      </div>

      {locales.map(locale => (
        <LanguageRow
          key={locale.code}
          code={locale.code}
          label={locale.label}
          rtl={locale.rtl}
          isDefault={locale.code === defaultLocale}
          state={languageState(translations?.[locale.code])}
          isActive={locale.code === active}
          canSeed={copy.available}
          {...(onSelect === undefined ? {} : { onSelect })}
          onSeed={() => {
            // The language being edited right now is the source; the row
            // clicked is the target. Switch first — seeding without switching
            // fills a language the author is not looking at — then ask, so the
            // confirm step names both sides correctly once the switch lands.
            onSelect?.(locale.code);
            copy.requestCopy(active);
          }}
          actionsDisabled={actionsDisabled}
        />
      ))}
      <CopyFromLanguageDialog copy={copy} />
    </div>
  );
}
