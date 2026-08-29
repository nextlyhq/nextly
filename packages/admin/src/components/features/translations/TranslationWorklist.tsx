"use client";

/**
 * The translation worklist — one language's outstanding work, across every
 * collection that has any.
 *
 * Every other translation surface in the admin answers "what state is THIS
 * document in": the language panel, translation mode, the language dots on a
 * list row. None of them can answer the question a translator actually arrives
 * with — *what needs me, anywhere, in my language?* — so finding the work meant
 * opening every document in turn.
 *
 * This is only the way IN. Choosing a row hands off to the editor that already
 * exists, in translation mode, with the source language already chosen. It
 * deliberately does not become a second editor: that would duplicate the form,
 * the unsaved-changes guard, autosave and the save intent, and it would make
 * this the fifth surface answering one question — which is the failure the
 * whole multilingual pass exists to undo.
 *
 * @module components/features/translations/TranslationWorklist
 */

import { useEffect } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
} from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { LOCALE_PARAM, TRANSLATE_PARAM } from "@admin/constants/search-params";
import { useBrandingStatus } from "@admin/context/providers/BrandingProvider";
import { useTranslationWorklist } from "@admin/hooks/queries/useTranslationWorklist";
import { useLocalization } from "@admin/hooks/useLocalization";
import { navigateTo } from "@admin/lib/navigation";
import {
  WORKLIST_STATES,
  resolveActiveTarget,
  type TranslationWorkRow,
  type WorklistState,
} from "@admin/types/translations/worklist";

/** Where a row goes: the document, in the target language, translating from the source. */
function rowHref(
  row: TranslationWorkRow,
  target: string,
  source: string
): string {
  const path = buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
    slug: row.collection,
    id: row.id,
  });
  // BOTH params, because the destination needs both facts: which language is
  // being edited, and which one is on display beside it. Sending only the
  // locale opens the ordinary editor in that language with no source — which
  // is not the screen this row promised.
  const params = new URLSearchParams({
    [LOCALE_PARAM]: target,
    [TRANSLATE_PARAM]: source,
  });
  return `${path}?${params.toString()}`;
}

function WorklistRow({
  row,
  target,
  source,
}: {
  row: TranslationWorkRow;
  target: string;
  source: string;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The title does not shrink away: it is the row's identity, and a
            truncated collection label still tells you where you are while a
            truncated title names nothing. */}
        <span className="truncate text-sm font-medium">{row.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {row.collectionLabel}
        </span>
      </div>
      {/* Named for the document AND its collection. Read out of context — a
          screen reader stepping through this list — fifty buttons all saying
          "Translate" name nothing at all, and the title alone is not enough
          either: titles are not unique, and this list deliberately spans
          collections, so two rows reading "Translate Untitled" is the ordinary
          case rather than the unlucky one. The collection is on screen beside
          the title; the accessible name has to carry it too, because a button
          reached by keyboard is read without its row.

          `navigateTo` rather than an anchor: this admin is a single page, and a
          real href would reload the whole application to reach a route the
          router already owns. It is the same call the entry list makes to open
          a row in a language. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Translate ${row.title} in ${row.collectionLabel}`}
        onClick={() => navigateTo(rowHref(row, target, source))}
      >
        Translate
      </Button>
    </li>
  );
}

/**
 * Which of three situations a missing language list actually is.
 *
 * `useLocalization` reports `enabled: false` for all three — the workspace
 * metadata still in flight, the workspace request having failed, and a real
 * single-language install — and only the last is a fact about the app. Drawing
 * the last conclusion from the first tells a translator opening a shared link
 * cold that their languages are gone.
 *
 * Named and returned rather than branched inline so the component has one
 * decision to render instead of three, and so the three can be told apart in a
 * test without rendering anything.
 */
type MetadataVerdict = "pending" | "unavailable" | "single-language" | "ready";

export function metadataVerdict({
  pending,
  unavailable,
  enabled,
}: {
  pending: boolean;
  unavailable: boolean;
  enabled: boolean;
}): MetadataVerdict {
  if (pending) return "pending";
  if (unavailable) return "unavailable";
  if (!enabled) return "single-language";
  return "ready";
}

/** What to show when the languages cannot be listed, and why. */
function MetadataNotice({ verdict }: { verdict: MetadataVerdict }) {
  if (verdict === "pending") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (verdict === "unavailable") {
    // The worklist endpoint may be perfectly healthy; what failed is the
    // metadata naming the languages. Saying which half is missing is the
    // difference between an operator checking the right thing and a translator
    // being told their configuration is empty.
    return (
      <Alert>
        <AlertTitle>Couldn&rsquo;t load this app&rsquo;s languages</AlertTitle>
        <AlertDescription>
          The workspace settings didn&rsquo;t load, so there is nothing to list
          a language&rsquo;s work against yet. Reloading usually resolves it.
        </AlertDescription>
      </Alert>
    );
  }
  // A fact rather than an absence: the app answered, and it has fewer than two
  // languages. A worklist there is a list that can never have a row, and saying
  // so beats an empty table that looks like a failed load.
  return (
    <Alert>
      <AlertTitle>No languages configured</AlertTitle>
      <AlertDescription>
        Add a second language to this app&rsquo;s localization config, and the
        work outstanding in it will be listed here.
      </AlertDescription>
    </Alert>
  );
}

function WorklistBody({
  rows,
  target,
  source,
  stateLabel,
  complete,
}: {
  rows: readonly TranslationWorkRow[];
  target: string;
  source: string;
  stateLabel: string;
  /** False when the server named collections it did not consult. */
  complete: boolean;
}) {
  if (rows.length === 0) {
    // Said, rather than shown as an empty list. A blank area under a filter
    // reads as "something failed" as easily as "nothing to do", and the two
    // deserve opposite reactions.
    //
    // And "nothing" is a claim about EVERYTHING, so it may only be made when
    // everything was looked at. With collections left unconsulted, no rows is
    // the one result that cannot be distinguished from work nobody checked
    // for — the alert above warns that the answer is partial, but this
    // sentence would still assert the opposite, and a reader takes the
    // sentence in the table over the banner above it.
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        {complete
          ? `Nothing ${stateLabel.toLowerCase()} in this language.`
          : `Nothing ${stateLabel.toLowerCase()} in the collections that could be checked.`}
      </p>
    );
  }
  return (
    // Named for the filter in force, not for the page's purpose. Under
    // Translated or Published every row is finished work, and announcing them
    // as "documents needing translation" tells a screen-reader user the
    // opposite of what the list holds — the visible tabs cannot correct it for
    // someone who lands on the list directly.
    <ul aria-label={`${stateLabel} documents`}>
      {rows.map(row => (
        <WorklistRow
          key={`${row.collection}:${row.id}`}
          row={row}
          target={target}
          source={source}
        />
      ))}
    </ul>
  );
}

/**
 * A labelled row of mutually exclusive toggles.
 *
 * The language row and the state row are the same control with different
 * contents, and they were written twice. One implementation means the pressed
 * state, the sizing and the `aria-pressed` contract cannot drift between the
 * two rows a reader compares side by side.
 */
function ChoiceRow({
  legend,
  options,
  selected,
  onSelect,
}: {
  legend: string;
  options: readonly { value: string; label: string }[];
  selected: string | undefined;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {legend}
      </span>
      {options.map(option => (
        <Button
          key={option.value}
          type="button"
          variant={option.value === selected ? "default" : "outline"}
          size="sm"
          aria-pressed={option.value === selected}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Names the collections this answer did not cover, or renders nothing.
 *
 * Named rather than swallowed: a worklist that silently omits a collection
 * reads as "nothing to do there", which is indistinguishable from the truth at
 * a glance and is the only way this page can lie.
 *
 * The wording states the OMISSION and not a cause, because the server reports
 * three through one field — the fan-out cap, a collection whose read failed,
 * and one whose count could not be trusted. Explaining it as capacity would
 * tell someone with a broken query that their site is too big: a confident
 * answer to a question they did not ask, pointing away from the fault.
 */
function NotConsultedNotice({ collections }: { collections: string[] }) {
  if (collections.length === 0) return null;
  return (
    <Alert>
      <AlertTitle>Not everything was checked</AlertTitle>
      <AlertDescription>
        These collections were left out of this answer: {collections.join(", ")}
        . That happens when a site has more collections than one request covers,
        or when a collection can&rsquo;t be read just now. Reload to see whether
        it was temporary.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Collections that could not answer the question this tab asks, and what to do about it.
 *
 * 🔴 A SECOND notice rather than more names in the first, and the reason is the remedy. The one
 * above ends with "Reload to see whether it was temporary", which is right for a fan-out cap and
 * for a collection that could not be read — and wrong here, where reloading changes nothing and
 * the operator would loop. This case has one specific fix and says it.
 *
 * 🔴 It also has to appear at all. A collection that cannot compare timestamps contributes no rows
 * to this tab, and no rows is indistinguishable from "nothing here needs review" — the reassuring
 * direction, and the exact claim this whole signal exists not to make by accident.
 */
function CannotAnswerNotice({ collections }: { collections: string[] }) {
  if (collections.length === 0) return null;
  return (
    <Alert>
      <AlertTitle>Some collections can&rsquo;t be checked yet</AlertTitle>
      <AlertDescription>
        These collections don&rsquo;t record when each language was last
        written, so nothing can tell whether their translations have fallen
        behind: {collections.join(", ")}. Run <code>nextly migrate</code> to add
        it — after that their languages are compared like everything else.
        Existing translations keep working in the meantime.
      </AlertDescription>
    </Alert>
  );
}

/** Loading, failed, or the list itself — the three a read can be in. */
function WorklistResult({
  query,
  active,
  source,
  stateLabel,
  complete,
}: {
  query: ReturnType<typeof useTranslationWorklist>;
  active: string | undefined;
  source: string;
  stateLabel: string;
  complete: boolean;
}) {
  if (query.isPending && active !== undefined) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load the worklist. {query.error.message}
      </p>
    );
  }
  return (
    <WorklistBody
      rows={query.data?.items ?? []}
      target={active ?? ""}
      source={source}
      stateLabel={stateLabel}
      complete={complete}
    />
  );
}

export function TranslationWorklist({
  locale,
  state,
  onLocaleChange,
  onLocaleCorrected,
  onStateChange,
}: {
  /** The language being worked on, or undefined before one is chosen. */
  locale: string | undefined;
  state: WorklistState;
  /** The reader picked a language: a new history entry. */
  onLocaleChange: (code: string) => void;
  /**
   * The URL named a language this worklist cannot answer for.
   *
   * Separate from `onLocaleChange` because it must REPLACE the history entry
   * rather than add one — see the effect below.
   */
  onLocaleCorrected: (code: string) => void;
  onStateChange: (state: WorklistState) => void;
}) {
  const { enabled, locales, defaultLocale } = useLocalization();
  // Consulted before any conclusion is drawn from missing locale metadata —
  // the branding types say to, for exactly this reason.
  const { isPending: brandingPending, isUnavailable: brandingUnavailable } =
    useBrandingStatus();
  // The active language is resolved BEFORE the query, not after it.
  //
  // Arriving from the sidebar there is no `?locale=`, so asking with `undefined`
  // leaves the query disabled — and a disabled query is `isPending` forever, so
  // the page sat on skeletons until someone clicked the language that was
  // already highlighted. The component knew which language it meant the whole
  // time; it simply worked it out one line too late.
  const source = defaultLocale;
  const targets = locales.filter(l => l.code !== source);
  // Not `locale ?? targets[0]`: a URL naming the SOURCE language is a
  // configured locale, so the server accepts it and answers nonsense — nothing
  // is missing in the language everything is written in, and every document
  // counts as translated. See `resolveActiveTarget`.
  const active = resolveActiveTarget(
    locale,
    targets.map(t => t.code)
  );
  const query = useTranslationWorklist({ locale: active, state });

  // Put the URL back in step when it asked for a language this worklist cannot
  // answer for, so the address bar keeps describing what is on screen and a
  // copied link reproduces it. Only when the URL NAMED one: arriving with no
  // `?locale=` is the ordinary path from the sidebar and must not be rewritten.
  //
  // A CORRECTION, not a choice — which is why it is a separate callback rather
  // than the same one with a flag. The page is overwriting a URL nobody can
  // act on, so it replaces the entry: pushing one would put the impossible
  // locale in history, and Back would restore it, re-run this effect and push
  // the correction again — a loop with no way past this page.
  useEffect(() => {
    if (locale !== undefined && active !== undefined && locale !== active) {
      onLocaleCorrected(active);
    }
  }, [locale, active, onLocaleCorrected]);

  // Three situations, one `enabled: false`, and only one of them is a fact
  // about the app. Resolved in a single named decision rather than three
  // branches in the render path — see `metadataVerdict`.
  const verdict = metadataVerdict({
    pending: brandingPending,
    unavailable: brandingUnavailable,
    enabled,
  });
  if (verdict !== "ready") return <MetadataNotice verdict={verdict} />;

  const stateLabel =
    WORKLIST_STATES.find(t => t.value === state)?.label ?? "outstanding";
  const notConsulted = query.data?.meta.notConsulted ?? [];
  const unanswerable = query.data?.meta.unanswerable ?? [];

  return (
    <div className="flex flex-col gap-4">
      <ChoiceRow
        legend="Language"
        options={targets.map(l => ({ value: l.code, label: l.label }))}
        selected={active}
        onSelect={onLocaleChange}
      />

      <ChoiceRow
        legend="Showing"
        options={WORKLIST_STATES.map(t => ({ value: t.value, label: t.label }))}
        selected={state}
        onSelect={next => onStateChange(next as WorklistState)}
      />

      <NotConsultedNotice collections={notConsulted} />
      <CannotAnswerNotice collections={unanswerable} />

      <div className="rounded-md border border-border">
        <WorklistResult
          query={query}
          active={active}
          source={source}
          stateLabel={stateLabel}
          complete={notConsulted.length === 0 && unanswerable.length === 0}
        />
      </div>

      {/* Says WHICH of the two it is showing. A truncated backlog presented as
          a complete one is the same lie as an unconsulted collection, one level
          down — so when more was found than fits, the count says so rather than
          reporting the slice as the whole. */}
      {query.data !== undefined && query.data.items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {query.data.meta.total > query.data.items.length ? (
            <>
              Showing <Badge variant="default">{query.data.items.length}</Badge>{" "}
              of {query.data.meta.total} documents
            </>
          ) : (
            <>
              <Badge variant="default">{query.data.items.length}</Badge>{" "}
              documents
            </>
          )}
        </p>
      )}
    </div>
  );
}
