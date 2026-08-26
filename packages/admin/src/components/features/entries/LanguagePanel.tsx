"use client";

/**
 * LanguagePanel — the document's language workflow in one place.
 *
 * Language state previously had no home: which language is active came from a
 * header control, what state the others were in came from a second control
 * beside it, and the actions lived in the document rail, which hides at
 * narrower widths. Each answered part of one question from a different place.
 *
 * This is that question's home — one row per language carrying its state, the
 * action that row makes sense of, and a way to fill any language from any
 * other. It renders in the rail where there is room and inline where there is
 * not, so it can never be the surface that disappeared.
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

import { Button, Input } from "@nextlyhq/ui";
import { useId, useState } from "react";

import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import { CompletenessMeter } from "./CompletenessMeter";
import { CopyFromLanguageDialog } from "./CopyFromLanguageDialog";
import { CopyFromLanguageMenu } from "./CopyFromLanguageMenu";
import { useEntryLocale } from "./EntryLocaleContext";
import { StateDot } from "./LanguageStateDot";
import { PublishAllConfirmDialog } from "./PublishAllConfirmDialog";
import {
  languageState,
  languageStateLabel,
  translationCounts,
  LANGUAGE_STATE_LABEL,
  type LanguageState,
  type LocaleTranslationMeta,
  type TranslationCounts,
} from "./translation-meta";
import {
  useCopyFromLanguage,
  type CopyFromLanguage,
} from "./useCopyFromLanguage";
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
/**
 * How many languages the panel shows before it offers a filter.
 *
 * A judgement rather than a measurement, and worth saying so: nothing here
 * derives it. Past roughly this many rows, finding one language stops being a
 * glance and becomes a scan, and a scan over identical rows is linear work
 * where a filter is not. Below it, a search box is chrome answering a question
 * nobody asked — most sites run two or three languages and must not pay for
 * the sites that run thirty.
 *
 * Deliberately NOT the entry list's `MAX_DOTS`. That answers a spatial
 * question — how many dots fit a table cell — and this answers a cognitive one,
 * so matching the numbers would tie two unrelated decisions together.
 */
const FILTER_THRESHOLD = 8;

/** Whether a language answers to what was typed, by name or by code. */
function matchesQuery(
  locale: { code: string; label: string },
  query: string
): boolean {
  // The CODE as well as the label: a translator working in Spanish types `es`
  // more readily than "Spanish", and where the admin's language differs from
  // the content languages the code can be the only spelling the two share.
  return (
    locale.label.toLowerCase().includes(query) ||
    locale.code.toLowerCase().includes(query)
  );
}

/** The states a dot can encode, in the order a language moves through them. */
const LEGEND_STATES: readonly LanguageState[] = [
  "published",
  "translated",
  "draft",
  "missing",
];

/**
 * What the dots mean, on request.
 *
 * The dot encodes state by SHAPE, which is decodable once someone has been told
 * the key and guessable by nobody. It previously lived in the header's language
 * menu; that menu is gone, and this was the one thing in it the panel did not
 * already carry.
 *
 * Closed by default because a ~320px rail cannot afford four permanent rows
 * explaining four dots, and an author who has learned them never needs it
 * again. `<details>` rather than a popover: it needs no positioning, works
 * without JavaScript, and is keyboard-operable by construction.
 *
 * The labels are the CANONICAL ones from `translation-meta`. A legend with
 * wording of its own would be a second vocabulary for the same states, which is
 * the failure this panel exists to end; the capitalisation is CSS.
 */
function StateLegend() {
  return (
    <details className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none marker:content-none">
        What do these mean?
      </summary>
      <div
        role="group"
        aria-label="Language states"
        className="mt-2 flex flex-col gap-1"
      >
        {LEGEND_STATES.map(state => (
          <span key={state} className="flex items-center gap-1.5">
            <StateDot state={state} />
            <span className="first-letter:uppercase">
              {LANGUAGE_STATE_LABEL[state]}
            </span>
          </span>
        ))}
      </div>
    </details>
  );
}

/**
 * The panel's title row: what it is, how far along it is, and what can be done
 * to every language at once.
 *
 * Wraps, because this row carries a label, a progress meter, a count and up to
 * two actions inside a ~320px rail. Fixed on one line the actions ran past the
 * card — measured, "Publish all" was drawn 47px beyond its edge while a
 * non-default language was being edited, which is exactly when it is the
 * control an author wants. The ROWS below solved the same squeeze by letting
 * their describing half give way; there is no such half here, since every part
 * of this row is either a number or a verb.
 *
 * Whether the translate action applies is decided by the caller and arrives as
 * ONE boolean. Three conditions ANDed inside the JSX read as one long line and
 * are three separate facts: a handler exists, this is not the source language,
 * and there is a source to translate from.
 */
function PanelHeader({
  counts,
  actionsDisabled,
  canPublishAll,
  publishPending,
  onPublishAll,
  offersTranslate,
  onTranslate,
}: {
  counts: TranslationCounts;
  actionsDisabled: boolean;
  canPublishAll: boolean;
  publishPending: boolean;
  onPublishAll: () => void;
  offersTranslate: boolean;
  onTranslate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Languages
      </span>
      <CompletenessMeter translated={counts.translated} total={counts.total} />
      <span className="text-xs tabular-nums text-muted-foreground">
        {counts.translated} of {counts.total} translated
      </span>
      <span className="flex-1" />
      {offersTranslate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={actionsDisabled}
          onClick={onTranslate}
        >
          Translate
        </Button>
      )}
      {canPublishAll && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={actionsDisabled || publishPending}
          onClick={onPublishAll}
        >
          {publishPending ? "Publishing…" : "Publish all"}
        </Button>
      )}
    </div>
  );
}

/**
 * The rows, or the sentence that replaces them.
 *
 * Its own component because the choice between the two is a whole branch around
 * a list, and leaving it inline put a second nested ternary inside a JSX tree
 * that already carries several — which is how a panel becomes hard to read
 * without any one line being complicated.
 */
function LanguageRows({
  shown,
  filter,
  translations,
  defaultLocale,
  active,
  copy,
  actionsDisabled,
  onSelect,
}: {
  shown: readonly { code: string; label: string; rtl: boolean }[];
  filter: string;
  /*
   * Required-but-nullable rather than optional, which is not a style choice:
   * under `exactOptionalPropertyTypes` an OPTIONAL prop cannot be handed a
   * `T | undefined`, so every call site has to spread it conditionally — and
   * each of those spreads is a branch in a component that already has several.
   * This is internal, so widening the contract costs nothing and the caller
   * passes the value it holds.
   */
  translations: Record<string, LocaleTranslationMeta> | undefined;
  defaultLocale: string;
  active: string;
  /** The one copy-from state, owned by the panel and shared by every row. */
  copy: CopyFromLanguage;
  actionsDisabled: boolean;
  onSelect:
    | ((code: string, options?: { seedFrom?: string }) => void)
    | undefined;
}) {
  if (shown.length === 0) {
    // Said rather than shown as an empty list. A list with no rows under a
    // search box reads as "this document has no languages", which is both
    // alarming and untrue — the query simply matched nothing.
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        No languages match “{filter.trim()}”.
      </p>
    );
  }

  return (
    <ul aria-label="Languages in this document">
      {shown.map(locale => (
        <LanguageRow
          key={locale.code}
          code={locale.code}
          label={locale.label}
          rtl={locale.rtl}
          isDefault={locale.code === defaultLocale}
          state={languageState(translations?.[locale.code])}
          pendingChange={translations?.[locale.code]?.pendingChange}
          isActive={locale.code === active}
          copy={copy}
          {...(onSelect === undefined ? {} : { onSelect })}
          onSeed={() => {
            // The row clicked is the target and the language being edited is
            // the source, and BOTH travel in the one switch call. Setting the
            // source separately here does not work: the switch refetches the
            // document and tears this panel down, so an intent recorded in it
            // is gone before anything can act on it. Whoever owns `locale`
            // carries the pair across, and the copy is offered on the far side
            // once the target's editor is on screen.
            onSelect?.(locale.code, { seedFrom: active });
          }}
          actionsDisabled={actionsDisabled}
        />
      ))}
    </ul>
  );
}

/**
 * Which languages the panel lists, and whether it offers a way to narrow them.
 *
 * One decision, answered once: the filter's visibility and the rows it produces
 * are two views of the same question — is this list long enough to search —
 * and computing them separately is how they come to disagree about the
 * threshold.
 *
 * A plain filter: what does not match is hidden, INCLUDING the language being
 * edited. Pinning the active row was tried and is worse — a row that survives a
 * query it does not match READS as a match, and on a search for something
 * absent it leaves one language on screen looking like the answer. The query is
 * transient and self-inflicted, and clearing it brings everything back.
 */
/**
 * One action, one word for it, and the state it acts on decides which word.
 *
 * "Start from…" on a language that already holds a translation says something
 * untrue, and the overwrite is the part an author needs told BEFORE the confirm
 * step rather than by it. Resolved here rather than at each trigger so the row
 * button and the active row's source picker can never drift into two names for
 * the same thing — which is the failure this whole panel exists to undo.
 */
function seedVerb(state: LanguageState): string {
  return state === "missing" ? "Start" : "Replace";
}

function filteredLanguages<T extends { code: string; label: string }>(
  locales: readonly T[],
  filter: string
): { offersFilter: boolean; shown: readonly T[] } {
  const offersFilter = locales.length > FILTER_THRESHOLD;
  const query = filter.trim().toLowerCase();
  if (!offersFilter || query === "") return { offersFilter, shown: locales };
  return { offersFilter, shown: locales.filter(l => matchesQuery(l, query)) };
}

function LanguageRow({
  code,
  label,
  rtl,
  isDefault,
  state,
  pendingChange,
  isActive,
  copy,
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
  copy: CopyFromLanguage;
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
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-muted-foreground">editing now</span>
          {/* The one row whose source cannot be implied. Every other row is
              filled from wherever the author is standing; this row IS where
              they are standing, so the source gets named here. Withholding it
              was what made a populated language unfillable from anywhere once
              the header's Languages menu was deleted. */}
          <CopyFromLanguageMenu
            copy={copy}
            verb={seedVerb(state)}
            targetLabel={label}
            disabled={actionsDisabled}
          />
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Offered on EVERY language, not only an empty one. Filling a
              language that already has content is an overwrite rather than a
              start, which is what the verb reports and what the confirm step
              then spells out; refusing the action instead left it reachable
              from nowhere. */}
          {copy.available && onSeed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={actionsDisabled}
              // Named for the language it acts on. Read out of context — a
              // screen reader listing this panel's controls — three buttons
              // all saying "Start from…" name no language at all.
              aria-label={`${seedVerb(state)} ${label} from another language`}
              onClick={onSeed}
            >
              {seedVerb(state)} from…
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
  const [filter, setFilter] = useState("");
  const filterId = useId();
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

  const { offersFilter, shown } = filteredLanguages(locales, filter);

  return (
    <div className={cn("rounded-md border border-border", className)}>
      <PanelHeader
        counts={counts}
        actionsDisabled={actionsDisabled}
        canPublishAll={publish.available}
        publishPending={publish.pending}
        onPublishAll={() => setConfirmPublishAll(true)}
        offersTranslate={
          onEnterTranslationMode !== undefined &&
          isNonDefaultLocale &&
          defaultLocale !== ""
        }
        onTranslate={() => onEnterTranslationMode?.(defaultLocale)}
      />

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

      {offersFilter && (
        <div className="border-b border-border px-3 py-2">
          <label className="sr-only" htmlFor={filterId}>
            Filter languages
          </label>
          <Input
            id={filterId}
            type="search"
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Filter languages…"
            className="h-7 text-xs"
          />
        </div>
      )}

      <LanguageRows
        shown={shown}
        filter={filter}
        translations={translations}
        defaultLocale={defaultLocale}
        active={active}
        copy={copy}
        actionsDisabled={actionsDisabled}
        onSelect={onSelect}
      />
      <StateLegend />
      <CopyFromLanguageDialog copy={copy} />
    </div>
  );
}
