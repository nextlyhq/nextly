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
import { CopyFromLanguageMenu } from "./CopyFromLanguageMenu";
import { useCopyFromLanguageScope } from "./CopyFromLanguageScope";
import { useEntryLocale } from "./EntryLocaleContext";
import { StateDot } from "./LanguageStateDot";
import { PublishAllConfirmDialog } from "./PublishAllConfirmDialog";
import {
  languageState,
  languageStateLabel,
  translationCounts,
  LANGUAGE_STATES,
  LANGUAGE_STATE_LABEL,
  type LanguageState,
  type LocaleTranslationMeta,
  type TranslationCounts,
} from "./translation-meta";
import type { CopyFromLanguage } from "./useCopyFromLanguage";
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
        {LANGUAGE_STATES.map(state => (
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
  copy,
  activeLabel,
  activeState,
  metaKnown,
}: {
  counts: TranslationCounts;
  /** The document's one copy-from state, or undefined where it does not apply. */
  copy: CopyFromLanguage | undefined;
  /** The language being edited — the target the header's picker fills. */
  activeLabel: string;
  /** Its state, which chooses the verb. */
  activeState: LanguageState;
  metaKnown: boolean;
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
      {/* The unit is stated, not left to the eyebrow above it. Every counter in
          the admin reads "N of M <unit> translated", and this was the one that
          did not: with three languages and two translatable fields the panel
          said "0 of 2" about languages while translation mode said "0 of 2"
          about fields, a few clicks apart. The numbers coincide exactly where a
          person first meets them. */}
      <span className="text-xs tabular-nums text-muted-foreground">
        {counts.translated} of {counts.total} languages translated
      </span>
      <span className="flex-1" />
      {/* Filling the language being EDITED lives here rather than on its row.
          Every other row implies its source — the author is standing in one
          language and acting on another — but this one is where they are
          standing, so the source has to be named. The header is where the
          panel's document-scoped actions already are, and unlike the row it
          wraps, so the control cannot be pushed out of reach. */}
      {copy !== undefined && (
        <CopyFromLanguageMenu
          copy={copy}
          verb={seedVerb(activeState, metaKnown)}
          targetLabel={activeLabel}
          disabled={actionsDisabled}
        />
      )}
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
  canSeed,
  metaKnown,
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
  canSeed: boolean;
  /** Whether `translations` was supplied at all — see `seedVerb`. */
  metaKnown: boolean;
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
          stale={translations?.[locale.code]?.stale}
          isActive={locale.code === active}
          canSeed={canSeed}
          metaKnown={metaKnown}
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
/**
 * What the header needs to know about the language being edited.
 *
 * Three readings of the same subject — its name, its state, and whether we were
 * told anything about it — resolved together because they are one question and
 * because the panel that renders them has no room left for three more
 * expressions of its own.
 */
function activeLanguageView(
  locales: readonly { code: string; label: string }[],
  translations: Record<string, LocaleTranslationMeta> | undefined,
  active: string
): { label: string; state: LanguageState; metaKnown: boolean } {
  return {
    label: locales.find(l => l.code === active)?.label ?? active,
    state: languageState(translations?.[active]),
    // An absent map is not an empty document — see `seedVerb`.
    metaKnown: translations !== undefined,
  };
}

/**
 * How many languages hold a saved change nobody has published.
 *
 * Stated in the publish-all confirm, because publishing every language is the
 * one action in this panel that can put another person's held edit on the
 * public site.
 */
function pendingLanguageCount(
  locales: readonly { code: string }[],
  translations: Record<string, LocaleTranslationMeta> | undefined
): number {
  return locales.filter(l => translations?.[l.code]?.pendingChange).length;
}

/**
 * Whether entering translation mode applies to what is on screen.
 *
 * Three conditions that only mean something together: the editor must offer the
 * mode at all, the language being edited must not be the source it would be
 * translated from, and there has to BE a source. Named once so the header reads
 * as one decision rather than three.
 */
function offersTranslateMode(
  onEnterTranslationMode: ((source: string) => void) | undefined,
  isNonDefaultLocale: boolean,
  defaultLocale: string
): boolean {
  return (
    onEnterTranslationMode !== undefined &&
    isNonDefaultLocale &&
    defaultLocale !== ""
  );
}

function seedVerb(state: LanguageState, metaKnown: boolean): string {
  // Unknown metadata is NOT an empty language. With no `_translations` map every
  // locale reads `missing`, which is a supported state for this panel — and
  // "Start from…" would then promise a fill with nothing to lose immediately
  // before the confirm step explains what it overwrites. When we do not know,
  // say the destructive thing.
  if (!metaKnown) return "Replace";
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

/**
 * A marker that merely describes the language: which one is the default, which reads
 * right-to-left. Muted, because nothing is being asked of the reader.
 */
const MARKER_PLAIN_CLASS =
  "min-w-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground";

/**
 * A marker naming something the author has to act on. Bordered and in the foreground colour, so
 * it separates from the descriptive ones at a glance.
 */
const MARKER_ACTIONABLE_CLASS =
  "shrink-0 rounded-sm border border-border px-1 text-[10px] uppercase tracking-wide text-foreground";

/**
 * The markers share ONE shrinkable strip rather than each holding its own width.
 *
 * A language can now carry four at once -- default, rtl, changes, review -- on a rail measured at
 * 277px whose label and two-button action group already refuse to shrink. With every marker
 * `shrink-0` the strip has no give, so past a certain width it paints into the Open/seed controls
 * and makes them unreachable: an overflow that costs an ACTION, not just legibility.
 *
 * So the strip yields as a unit and the descriptive markers truncate inside it, while the two
 * ACTIONABLE chips keep their width -- they are the ones naming something to be done, and a
 * truncated "chan…" is the fact an author needed. `min-w-0` is what lets a flex child shrink
 * below its content at all; without it the strip reports its content width and nothing gives.
 */
const MARKER_STRIP_CLASS = "flex min-w-0 shrink items-center gap-2";

/**
 * The markers a language row shows, in a FIXED order.
 *
 * Derived as a list rather than written as four conditionals in the JSX, and the order being
 * stated once here is the point: a row whose markers reorder according to which happen to be set
 * reads as a different kind of row each time, and an order spread across four independent `&&`
 * branches is not something anybody can check.
 *
 * All of them are `shrink-0`, which is measured rather than stylistic. In a 277px rail the row's
 * describing half is the part that gives way, so a marker that shrank would truncate to nothing
 * exactly when the row is tight — and "published · unpublished changes" truncating to
 * "publishe…" hides the one fact in the row an author has to act on. The state text beside them
 * is the thing that yields instead.
 */
function rowMarkers(flags: {
  isDefault?: boolean;
  rtl?: boolean;
  pendingChange?: boolean;
  stale?: boolean;
}): { text: string; title?: string; actionable: boolean }[] {
  const markers: { text: string; title?: string; actionable: boolean }[] = [];
  if (flags.isDefault) markers.push({ text: "default", actionable: false });
  if (flags.rtl) markers.push({ text: "rtl", actionable: false });
  if (flags.pendingChange) {
    markers.push({
      text: "changes",
      title: "This language has changes that have not been published",
      actionable: true,
    });
  }
  if (flags.stale) {
    markers.push({
      text: "review",
      title:
        "The source language was edited after this translation was written",
      actionable: true,
    });
  }
  return markers;
}

function LanguageRow({
  code,
  label,
  rtl,
  isDefault,
  state,
  pendingChange,
  stale,
  isActive,
  canSeed,
  metaKnown,
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
  /** i18n B2: the source language moved after this one was written. */
  stale?: boolean;
  isActive: boolean;
  canSeed: boolean;
  metaKnown: boolean;
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
        <span className={MARKER_STRIP_CLASS}>
          {rowMarkers({ isDefault, rtl, pendingChange, stale }).map(marker => (
            <span
              key={marker.text}
              className={
                marker.actionable ? MARKER_ACTIONABLE_CLASS : MARKER_PLAIN_CLASS
              }
              title={marker.title}
            >
              {marker.text}
            </span>
          ))}
        </span>
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={languageStateLabel(state, { pendingChange, stale })}
        >
          {LANGUAGE_STATE_LABEL[state]}
        </span>
      </div>
      {/* The active row carries NO action. Filling the language being edited is
          offered from the panel header instead, because this row cannot hold
          it: measured in a 277px rail, adding a 100px control here drove the
          non-shrinking half of the row 32px into it for a label as short as
          "English", and 120px for "Brazilian Portuguese". The row's describing
          half is already the part that gives way, and it had no more to give. */}
      {isActive ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          editing now
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Offered on EVERY language, not only an empty one. Filling a
              language that already has content is an overwrite rather than a
              start, which is what the verb reports and what the confirm step
              then spells out; refusing the action instead left it reachable
              from nowhere. */}
          {canSeed && onSeed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={actionsDisabled}
              // Named for the language it acts on. Read out of context — a
              // screen reader listing this panel's controls — three buttons
              // all saying "Start from…" name no language at all.
              aria-label={`${seedVerb(state, metaKnown)} ${label} from another language`}
              onClick={onSeed}
            >
              {seedVerb(state, metaKnown)} from…
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
  const copy = useCopyFromLanguageScope();
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
  const pendingCount = pendingLanguageCount(locales, translations);
  const counts = translationCounts(
    translations,
    locales.map(l => l.code),
    defaultLocale
  );

  const { offersFilter, shown } = filteredLanguages(locales, filter);
  const activeLanguage = activeLanguageView(locales, translations, active);

  return (
    <div className={cn("rounded-md border border-border", className)}>
      <PanelHeader
        counts={counts}
        copy={copy}
        activeLabel={activeLanguage.label}
        activeState={activeLanguage.state}
        metaKnown={activeLanguage.metaKnown}
        actionsDisabled={actionsDisabled}
        canPublishAll={publish.available}
        publishPending={publish.pending}
        onPublishAll={() => setConfirmPublishAll(true)}
        offersTranslate={offersTranslateMode(
          onEnterTranslationMode,
          isNonDefaultLocale,
          defaultLocale
        )}
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
        canSeed={copy?.available ?? false}
        metaKnown={activeLanguage.metaKnown}
        actionsDisabled={actionsDisabled}
        onSelect={onSelect}
      />
      <StateLegend />
    </div>
  );
}
