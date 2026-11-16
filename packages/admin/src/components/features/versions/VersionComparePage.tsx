/**
 * A document's version history, as a page.
 *
 * A comparison is two columns of field values, and the history panel is 480px —
 * which is why comparing from the panel had to escape into a dialog stacked
 * over it. A page gives the comparison the width it needs, removes the second
 * floating surface, and makes the browser's own back button the way out.
 *
 * The pair being compared lives in the URL (`?from=&to=`), so a comparison is
 * addressable: it can be linked into a review rather than described. That is
 * the concrete reason this is a route and not a larger dialog.
 *
 * @module components/features/versions/VersionComparePage
 */

import { ArrowLeft } from "lucide-react";
import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";

import { Alert, AlertDescription, Button } from "@admin/components/ui";
import { withQuery } from "@admin/constants/routes";
import { LOCALE_PARAM } from "@admin/constants/search-params";
import {
  scopeKey,
  useBaselineDiff,
  useVersions,
} from "@admin/hooks/queries/useVersions";
import { useCan } from "@admin/hooks/useCan";
import { validationIssues } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import type { VersionScope } from "@admin/services/versionApi";

import type { ChangesLayout } from "./diff/changes-layout";
import { VersionDiffView } from "./diff/VersionDiffView";
import { HISTORY_PARAM, RESTORE_PARAM, VERSION_PARAM } from "./history-address";
import {
  HISTORY_FRAME,
  HISTORY_HEAD,
  HISTORY_RAIL,
  HISTORY_SPLIT,
  HISTORY_TITLES,
} from "./history-layout";
import { useMarkVersionSeen } from "./useMarkVersionSeen";
import { predecessorOf, type PairResolution } from "./version-pairing";
import {
  namesServerBaseline,
  resolvePair,
  type ComparisonFrom,
} from "./version-search-params";
import { versionsHref } from "./versions-href";
import { VersionTimelineRail } from "./VersionTimelineRail";

export interface VersionComparePageProps {
  scope: VersionScope;
  /** Where the back control returns to — the document this history belongs to. */
  documentHref: string;
  /**
   * Where to return instead when the viewer may only READ this document.
   *
   * Reading a history needs `read-${slug}`; the document's own editor needs
   * `update-${slug}`. So a colleague can open a shared comparison, read it, and
   * be sent to a permission-denied page by the one control that is always on
   * screen. This is the destination their permission does reach.
   */
  readOnlyHref: string;
  /** The document's title, so the page says which document it is about. */
  documentTitle?: string;
  /**
   * The pair from the URL. Either may be absent on a link that names none;
   * `from` may name the version before `to` in its language (`previous`).
   */
  from?: ComparisonFrom;
  to?: number;
  /**
   * The language the address names. The page then lists that language's
   * versions (and the shared ones), as the history panel's language filter
   * does, so a link shared from a German history opens on German history.
   * Absent lists every language.
   */
  locale?: string;
  /** How the address asks the comparison to be drawn. */
  view?: "inline" | "side";
}

/** The baselines a reader may compare with, as "Compare with" offers them. */
const COMPARE_WITH: readonly { value: string; label: string }[] = [
  { value: "previous", label: "The version before" },
  { value: "published", label: "What is published" },
  { value: "draft", label: "The current draft" },
  { value: "last-viewed", label: "The version you last looked at" },
];

/** A baseline's name, as the page says it in a sentence. */
const BASELINE_PHRASE: Record<string, string> = {
  previous: "the version before",
  published: "what is published",
  draft: "the current draft",
  "last-viewed": "the version you last looked at",
};

/**
 * Which version the server compared with, in words: the baseline it resolved,
 * and, where retention had removed the version that baseline named, which one
 * stands in for it.
 */
function BaselineNote({
  baseline,
}: {
  baseline: { name: string; versionNo: number; replaces?: number };
}) {
  const phrase = BASELINE_PHRASE[baseline.name] ?? baseline.name;
  return (
    <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
      {baseline.replaces !== undefined
        ? baseline.name === "last-viewed"
          ? `Version ${baseline.replaces}, the one you last looked at, is no longer kept. Compared with version ${baseline.versionNo} instead.`
          : `Version ${baseline.replaces} is no longer kept. Compared with version ${baseline.versionNo} instead.`
        : `Compared with ${phrase} (version ${baseline.versionNo}).`}
    </p>
  );
}

/**
 * Why there is nothing to compare, in the reader's terms.
 *
 * A table rather than nested conditionals, so adding a reason is data — and so
 * that no reason can quietly fall through to another's sentence, which is how
 * a document with no versions came to be told it had exactly one.
 */
const NO_PAIR_MESSAGE: Record<
  Exclude<PairResolution["kind"], "pair" | "baseline">,
  string
> = {
  // The rail already states that the history is empty and what to do about
  // it. This side answers only why no COMPARISON is drawn, so the two
  // surfaces say different things rather than the same thing twice.
  "no-history": "There is nothing to compare yet.",
  "only-version":
    "There is only one version so far, so there is nothing to compare it with.",
  // Deliberately different from the line above. Saying "there is only one
  // version" beside a rail listing several would leave a reader unable to tell
  // which surface to believe; this says which language is meant, and that
  // there is somewhere else to look.
  "only-in-locale":
    "This is the only version in this language, so there is nothing to compare " +
    "it with. Versions in other languages have their own history.",
  "not-loaded":
    "The version before this one has not been loaded yet. Choose Load more in the list to fetch it.",
};

/** What fills the comparison side: a failure, a reason there is no pair, or one. */
function ComparisonPane({
  scope,
  pair,
  baselineDiff,
  view,
  onViewChange,
  onShown,
  isError,
  isLoading,
  onRetry,
}: {
  scope: VersionScope;
  pair: PairResolution;
  /** The server's answer for a baseline it resolves. */
  baselineDiff: ReturnType<typeof useBaselineDiff>;
  view?: "inline" | "side";
  onViewChange: (layout: ChangesLayout) => void;
  /** Hears the diff view report the comparison it has drawn. */
  onShown: (pair: { from: number; to: number } | null) => void;
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Alert variant="destructive">
          <AlertDescription>
            This document&apos;s history could not be loaded.
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (pair.kind === "baseline") {
    if (baselineDiff.isError) {
      // A baseline with nothing to compare with (no current draft, nothing
      // published, no earlier visit) is refused with the reason in the
      // server's words; any other failure is a comparison that did not load.
      const reason = validationIssues(baselineDiff.error).find(
        issue => issue.code === "NO_BASELINE"
      )?.message;
      return (
        <div className="p-4">
          <Alert variant={reason ? "info" : "destructive"}>
            <AlertDescription>
              {reason ?? "This comparison could not be loaded."}
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    const data = baselineDiff.data;
    if (!data) {
      return (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">Loading comparison…</p>
        </div>
      );
    }
    return (
      <>
        {data.baseline ? <BaselineNote baseline={data.baseline} /> : null}
        <VersionDiffView
          key={`${scopeKey(scope).join(":")}:${data.from}-${data.to}`}
          scope={scope}
          from={data.from}
          to={data.to}
          {...(view ? { view } : {})}
          onViewChange={onViewChange}
          onShown={onShown}
        />
      </>
    );
  }

  if (pair.kind !== "pair") {
    // Said plainly rather than shown as an empty comparison, which would read
    // as "nothing changed" — the answer this feature must never give by
    // accident. Which sentence depends on WHY there is no pair: the three cases
    // are different situations and a reader acts differently on each.
    return (
      <div className="px-4 py-8 text-center">
        {/* Keyed by what it says, so the answer replaces the loading line as a
            new line rather than rewriting its text in place: centred text
            rewritten in place starts at a new point, which the browser counts
            as the line moving. */}
        <p
          key={isLoading ? "loading" : pair.kind}
          className="text-sm text-muted-foreground"
        >
          {isLoading ? "Loading history…" : NO_PAIR_MESSAGE[pair.kind]}
        </p>
      </div>
    );
  }

  return (
    <VersionDiffView
      // Keyed by the DOCUMENT as well as the pair. Moving between two
      // documents' histories can carry the same `from`/`to`, and the diff query
      // keeps previous data while the new one loads — so without the scope here
      // the previous document's comparison stays painted under the new
      // document's heading.
      key={`${scopeKey(scope).join(":")}:${pair.from}-${pair.to}`}
      scope={scope}
      from={pair.from}
      to={pair.to}
      {...(view ? { view } : {})}
      onViewChange={onViewChange}
      onShown={onShown}
    />
  );
}

export function VersionComparePage({
  scope,
  documentHref,
  readOnlyHref,
  documentTitle,
  from,
  to,
  locale,
  view,
}: VersionComparePageProps): JSX.Element {
  const list = useVersions({ scope, locale });
  // `useCan` answers false while permissions load, which is the right default
  // here: the read-only destination is reachable by everyone who can reach this
  // page, so an unresolved permission costs a less specific target rather than
  // a dead link.
  const canEditDocument = useCan(`update-${scope.slug}`);
  const backHref = canEditDocument ? documentHref : readOnlyHref;

  // Autosave rows carry a null `versionNo` and cannot be compared, so they are
  // not offered as either half of a pair.
  const versions = useMemo(
    () => list.data?.pages.flatMap(page => page.items) ?? [],
    [list.data]
  );
  const pair = resolvePair(versions, from, to, list.hasNextPage ?? false);
  // Derived once and given to BOTH surfaces. An infinite query flips to
  // `isError` when a LATER page fails while keeping the pages it already holds,
  // so the aggregate state says "this failed" about a page nobody asked for.
  // Passed raw, it erases the rail's rows on one surface and unmounts a valid
  // comparison on the other — two different lies about the same event. Only a
  // failure that left nothing on screen is a failure of the history itself.
  const historyUnavailable = list.isError && versions.length === 0;

  // A baseline only the server resolves is asked of it; its answer names the
  // two versions compared.
  const baselineDiff = useBaselineDiff({
    scope,
    baseline: pair.kind === "baseline" ? pair.baseline : null,
    ...(pair.kind === "baseline" && pair.to !== undefined
      ? { to: pair.to }
      : {}),
  });
  const pairFrom = pair.kind === "pair" ? pair.from : baselineDiff.data?.from;
  const pairTo = pair.kind === "pair" ? pair.to : baselineDiff.data?.to;
  const shown = useMemo(
    () =>
      pairFrom !== undefined && pairTo !== undefined
        ? { from: pairFrom, to: pairTo }
        : null,
    [pairFrom, pairTo]
  );
  // Seen means drawn, and only the diff view knows when it has drawn a
  // comparison's fields: anything the page could judge from (a query that
  // loaded, a pair that resolved) also holds while the space shows a loading
  // line, a failure, or another pair's answer instead. So the page marks only
  // from the view's own report, tagged with the document it was made for.
  const scopeId = scopeKey(scope).join(":");
  const [reported, setReported] = useState<{
    scopeId: string;
    from: number;
    to: number;
  } | null>(null);
  const onShown = useCallback(
    (drawnPair: { from: number; to: number } | null) =>
      setReported(drawnPair ? { scopeId, ...drawnPair } : null),
    [scopeId]
  );
  // A report counts only for the document and pair now on screen, so one left
  // over from a previous document or pair can never mark this one.
  const seen =
    reported !== null &&
    shown !== null &&
    reported.scopeId === scopeId &&
    reported.from === shown.from &&
    reported.to === shown.to
      ? reported
      : null;
  // The newer of the two is what the reader has now seen, whichever side it
  // is on, once per showing.
  useMarkVersionSeen(
    scope,
    scopeId,
    seen ? Math.max(seen.from, seen.to) : null
  );

  /** The same comparison, at another baseline or in another view. */
  const rewrite = useCallback(
    (next: { from?: ComparisonFrom; view?: "inline" | "side" }) => {
      const nextFrom = next.from ?? from ?? shown?.from;
      if (nextFrom === undefined) return;
      // A baseline the server resolves keeps the address's own target, and
      // one the address left to the server stays so, whether the view or the
      // baseline changes. Pinning the version the server chose would ask a
      // different question: "the version you last looked at", asked about the
      // version this page has just marked seen, has nothing earlier to compare
      // with, so the comparison would vanish on a change of layout. A pair of
      // versions, or "the version before", is drawn on the client from the
      // version it ends at, so that one names the version on screen.
      const nextTo = namesServerBaseline(nextFrom) ? to : (shown?.to ?? to);
      navigateTo(
        versionsHref(
          scope,
          { from: nextFrom, ...(nextTo !== undefined ? { to: nextTo } : {}) },
          locale,
          next.view ?? view
        )
      );
    },
    [from, to, shown, scope, locale, view]
  );
  const onViewChange = useCallback(
    (layout: ChangesLayout) =>
      rewrite({ view: layout === "split" ? "side" : "inline" }),
    [rewrite]
  );

  // Choosing a row compares it against the version before it IN ITS OWN LOCALE,
  // and writes that choice to the URL so the comparison on screen is the one the
  // address names. A localized document interleaves its languages in one
  // numbered history, so the row below is routinely another language — a pair
  // the server rejects outright.
  const selectPair = useCallback(
    (versionNo: number) => {
      const previous = predecessorOf(
        versions,
        versionNo,
        list.hasNextPage ?? false
      );
      if (previous.kind !== "version") return;
      // Compared as the VALUES that decide the comparison, not as URL text.
      // `navigateTo` skips a push only when its argument equals
      // `window.location.pathname`, which a target carrying a query never does,
      // so choosing the row already on screen stacked another identical entry
      // and Back walked through indistinguishable copies of one comparison.
      // Comparing serialized text instead would answer differently for
      // `?to=9&from=8`, or for a link carrying an unrelated parameter, and
      // reinstate exactly that — these two numbers are what `resolvePair`
      // reads, so they are what "the same comparison" means.
      if (previous.versionNo === from && versionNo === to) return;
      // Built through the same `versionsHref` the history sheet uses, so one
      // place decides what a comparison's address looks like. Hand-building it
      // here is how the locale came to be dropped: the address was assembled
      // from the two numbers this callback happens to hold, and a language is
      // not one of them.
      //
      // The locale is taken from the SELECTED version rather than carried from
      // the current address, so choosing a row in another language moves the
      // page to that language instead of keeping the previous one. The rail
      // interleaves locales, so the row a reader clicks is routinely not in the
      // language now on screen.
      navigateTo(
        versionsHref(
          scope,
          { from: previous.versionNo, to: versionNo },
          versions.find(v => v.versionNo === versionNo)?.locale
        )
      );
    },
    [versions, list.hasNextPage, from, to, scope]
  );

  return (
    <div className={HISTORY_FRAME}>
      <header data-frame-part="history-head" className={HISTORY_HEAD}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={canEditDocument ? "Back to the document" : "Back"}
          onClick={() => navigateTo(backHref)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className={HISTORY_TITLES}>
          <h1 className="truncate text-base font-semibold text-foreground">
            Version history
          </h1>
          {/* The document's name keeps its line while it is read, so the
              header does not grow under the reader when the name arrives. */}
          <p
            className="truncate text-xs text-muted-foreground"
            aria-hidden={documentTitle ? undefined : true}
          >
            {documentTitle || "\u00a0"}
          </p>
        </div>
      </header>

      {/* Stacked below `lg`, side by side above it. The rail is a fixed 18rem,
          and at a 375px viewport that leaves the comparison roughly 87px before
          borders and padding — its pair description, filter and field values
          all clipped. `DashboardLayout` already switches to a mobile header at
          the same breakpoint, so the split is what has to give, not the
          content beside it. Stacked, the rail keeps a bounded height so the
          comparison is reachable without scrolling past the whole history. */}
      <div className={HISTORY_SPLIT}>
        <aside className={HISTORY_RAIL}>
          <VersionTimelineRail
            scope={scope}
            versions={versions}
            selected={pair.kind === "pair" ? pair.to : null}
            onSelect={selectPair}
            isLoading={list.isLoading}
            isError={historyUnavailable}
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            // Page-specific, not the aggregate: `historyUnavailable` above
            // answers whether the history could be read at all, and a later
            // page failing is a different event with a different remedy.
            nextPageError={list.isFetchNextPageError ? list.error : null}
          />
        </aside>

        {/* A labelled region rather than `main`: the dashboard shell already
            provides the document's one primary landmark, and nesting a second
            makes landmark navigation announce two. */}
        <section
          aria-label="Comparison"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
              Compare with
              <select
                aria-label="Compare with"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                value={typeof from === "string" ? from : "chosen"}
                onChange={event => {
                  const value = event.target.value;
                  if (value !== "chosen")
                    rewrite({ from: value as ComparisonFrom });
                }}
              >
                {typeof from === "string" ? null : (
                  <option value="chosen">The version chosen in the list</option>
                )}
                {COMPARE_WITH.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {canEditDocument && shown ? (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                // The editor restores it: the values go back as unsaved
                // edits through its list, and nothing is saved from here.
                // The comparison's language goes with it, under the key the
                // editor reads its language from: the editor offers a
                // version's restore only while open in that version's
                // language, so one opened in its default language would take
                // the hand-off and never show the restore list. Absent for a
                // comparison that names no language, as the editor expects.
                onClick={() =>
                  navigateTo(
                    withQuery(documentHref, {
                      [HISTORY_PARAM]: 1,
                      [VERSION_PARAM]: shown.to,
                      [RESTORE_PARAM]: 1,
                      [LOCALE_PARAM]: locale,
                    })
                  )
                }
              >
                Restore…
              </Button>
            ) : null}
          </div>
          <ComparisonPane
            scope={scope}
            pair={pair}
            baselineDiff={baselineDiff}
            {...(view ? { view } : {})}
            onViewChange={onViewChange}
            onShown={onShown}
            isError={historyUnavailable}
            isLoading={list.isLoading}
            onRetry={() => void list.refetch()}
          />
        </section>
      </div>
    </div>
  );
}
