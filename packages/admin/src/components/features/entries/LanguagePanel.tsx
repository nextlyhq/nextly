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
 * Renders nothing unless the app has several languages AND this document is
 * localized, so non-localized editors are unchanged.
 *
 * @module components/features/entries/LanguagePanel
 */

import { Button } from "@nextlyhq/ui";
import { useState } from "react";

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import { CompletenessMeter } from "./CompletenessMeter";
import { CopyFromLanguageDialog } from "./CopyFromLanguageDialog";
import { useEntryLocale } from "./EntryLocaleContext";
import {
  languageState,
  languageStateLabel,
  LANGUAGE_STATE_LABEL,
  StateDot,
  type LanguageState,
} from "./LanguageControl";
import { PublishAllConfirmDialog } from "./PublishAllConfirmDialog";
import {
  translationCounts,
  type LocaleTranslationMeta,
} from "./translation-meta";
import { useCopyFromLanguage } from "./useCopyFromLanguage";
import { usePublishAllLanguages } from "./usePublishAllLanguages";

export interface LanguagePanelProps {
  /** The entry's `_translations` map, keyed by locale code. */
  translations?: Record<string, LocaleTranslationMeta>;
  /** The active editing locale (undefined = the app default). */
  activeLocale?: string;
  /**
   * Switch the editor to a language. `seedFrom` rides along so the request to
   * seed the target survives the refetch the switch triggers.
   */
  onSelect?: (code: string, options?: { seedFrom?: string }) => void;
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
function LanguageRow({
  code,
  label,
  rtl,
  isDefault,
  state,
  pendingChange,
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
  /** Whether this language holds a saved change nobody has published. */
  pendingChange?: boolean;
  isActive: boolean;
  canSeed: boolean;
  onSelect?: (code: string, options?: { seedFrom?: string }) => void;
  onSeed?: () => void;
  actionsDisabled: boolean;
}) {
  return (
    <li className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0">
      {/* The describing half SHRINKS and the acting half does not. This row
          lives in a 320px rail, and with a long label, a `default`/`rtl` badge
          and a state to report there is not always room for both buttons —
          measured, the "Open" of an untranslated RTL language sat 38px past the
          row's own right edge, unreachable by pointer. Truncating the state text
          costs nothing that is not said elsewhere: the dot encodes it by SHAPE,
          and the language button's accessible name carries it in words. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StateDot state={state} />
        {/* The language NAME does not yield. It is the row's identity, and a
            flex row that shrinks everything proportionally turned "Arabic" into
            "A…" — which names nothing — while the state beside it still read in
            full. The state text below is the one thing that gives way. */}
        <span className="shrink-0 whitespace-nowrap text-sm font-medium">
          {label}
        </span>
        {isDefault && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            default
          </span>
        )}
        {rtl && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            rtl
          </span>
        )}
        {/* A chip, not part of the state text, and measured that way: in a
            277px rail "published · unpublished changes" truncated to
            "publishe…", which hides the one fact in the row an author has to
            act on. The chip does not shrink, so it survives at any width — the
            same device the `default` and `rtl` markers already use. */}
        {pendingChange && (
          <span
            className="shrink-0 rounded-sm border border-border px-1 text-[10px] uppercase tracking-wide text-foreground"
            title="This language has changes that have not been published"
          >
            changes
          </span>
        )}
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={languageStateLabel(state, pendingChange)}
        >
          {LANGUAGE_STATE_LABEL[state]}
        </span>
      </div>
      {isActive ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          editing now
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
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
              // Named for the language it acts on. Read out of context — a
              // screen reader listing this panel's controls — three buttons
              // all saying "Start from…" name no language at all.
              aria-label={`Start ${label} from another language`}
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
              // Switching languages is withheld under the same gate that
              // withholds the mutations: while a past version is on screen,
              // changing the document underneath the history banner shows one
              // language's history labelled as another's.
              disabled={actionsDisabled}
              aria-label={`Open ${label}`}
              onClick={() => onSelect(code)}
            >
              Open
            </Button>
          )}
        </div>
      )}
    </li>
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
  const [confirmPublishAll, setConfirmPublishAll] = useState(false);
  const { enabled, locales, defaultLocale } = useLocalization();
  const { collectionLocalized, isNonDefaultLocale, onEnterTranslationMode } =
    useEntryLocale();
  const copy = useCopyFromLanguage();
  const publish = usePublishAllLanguages(
    hasStatus === undefined ? {} : { hasStatus }
  );

  // Two switches, and both have to be on. `enabled` is the APP's — several
  // languages are configured — while `collectionLocalized` is this DOCUMENT's.
  // Reading only the first puts a language panel on a document that has no
  // language dimension, where every row after the default reads "not
  // translated": a claim about content that cannot exist rather than work left
  // to do.
  if (!enabled || !collectionLocalized || locales.length < 2) return null;

  const active = activeLocale ?? defaultLocale;
  // How many languages hold work nobody has published. Stated in the confirm
  // below, because publishing all of them is the one action here that can put
  // another person's held edit on the public site.
  const pendingCount = locales.filter(
    l => translations?.[l.code]?.pendingChange
  ).length;
  const counts = translationCounts(
    translations,
    locales.map(l => l.code),
    defaultLocale
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
        {/* Offered only while a NON-default language is being edited, because
            that is the only time there is a translation to do: the default is
            the language everything else is translated FROM, so pairing it with
            itself is the one arrangement the mode cannot show. The source is the
            default language — the overwhelmingly common pairing, and the URL
            carries the source explicitly so a different one is addressable
            without this control needing to grow a picker. */}
        {onEnterTranslationMode && isNonDefaultLocale && defaultLocale && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={actionsDisabled}
            onClick={() => onEnterTranslationMode(defaultLocale)}
          >
            Translate
          </Button>
        )}
        {publish.available && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={actionsDisabled || publish.pending}
            onClick={() => setConfirmPublishAll(true)}
          >
            {publish.pending ? "Publishing…" : "Publish all"}
          </Button>
        )}
      </div>

      <PublishAllConfirmDialog
        open={confirmPublishAll}
        onOpenChange={setConfirmPublishAll}
        languageCount={locales.length}
        pendingCount={pendingCount}
        isLoading={publish.pending}
        onConfirm={() => {
          publish.publishAll();
          setConfirmPublishAll(false);
        }}
      />

      <ul aria-label="Languages in this document">
        {locales.map(locale => (
          <LanguageRow
            key={locale.code}
            code={locale.code}
            label={locale.label}
            rtl={locale.rtl}
            isDefault={locale.code === defaultLocale}
            state={languageState(translations?.[locale.code])}
            pendingChange={translations?.[locale.code]?.pendingChange}
            isActive={locale.code === active}
            canSeed={copy.available}
            {...(onSelect === undefined ? {} : { onSelect })}
            onSeed={() => {
              // The row clicked is the target and the language being edited is
              // the source, and BOTH travel in the one switch call. Setting the
              // source separately here does not work: the switch refetches the
              // document and tears this panel down, so an intent recorded in it
              // is gone before anything can act on it. Whoever owns `locale`
              // carries the pair across, and the copy is offered on the far
              // side once the target's editor is on screen.
              onSelect?.(locale.code, { seedFrom: active });
            }}
            actionsDisabled={actionsDisabled}
          />
        ))}
      </ul>
      <CopyFromLanguageDialog copy={copy} />
    </div>
  );
}
