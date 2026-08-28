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
import { useCallback, useMemo } from "react";

import { Alert, AlertDescription, Button } from "@admin/components/ui";
import { ROUTES, buildRoute, withQuery } from "@admin/constants/routes";
import { scopeKey, useVersions } from "@admin/hooks/queries/useVersions";
import { useCan } from "@admin/hooks/useCan";
import { navigateTo } from "@admin/lib/navigation";
import type { VersionScope } from "@admin/services/versionApi";

import { VersionDiffView } from "./diff/VersionDiffView";
import { predecessorOf, type PairResolution } from "./version-pairing";
import { resolvePair } from "./version-search-params";
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
  /** The pair from the URL. Either may be absent on a link that names none. */
  from?: number;
  to?: number;
}

/**
 * Why there is nothing to compare, in the reader's terms.
 *
 * A table rather than nested conditionals, so adding a reason is data — and so
 * that no reason can quietly fall through to another's sentence, which is how
 * a document with no versions came to be told it had exactly one.
 */
const NO_PAIR_MESSAGE: Record<
  Exclude<PairResolution["kind"], "pair">,
  string
> = {
  // The rail already states that the history is empty and what to do about
  // it. This side answers only why no COMPARISON is drawn, so the two
  // surfaces say different things rather than the same thing twice.
  "no-history": "There is nothing to compare yet.",
  "only-version":
    "There is only one version so far, so there is nothing to compare it with.",
  "not-loaded":
    "The version before this one has not been loaded yet. Choose Load more in the list to fetch it.",
};

/** What fills the comparison side: a failure, a reason there is no pair, or one. */
function ComparisonPane({
  scope,
  pair,
  isError,
  isLoading,
  onRetry,
}: {
  scope: VersionScope;
  pair: PairResolution;
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

  if (pair.kind !== "pair") {
    // Said plainly rather than shown as an empty comparison, which would read
    // as "nothing changed" — the answer this feature must never give by
    // accident. Which sentence depends on WHY there is no pair: the three cases
    // are different situations and a reader acts differently on each.
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
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
}: VersionComparePageProps) {
  const list = useVersions({ scope });
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
      const target = withQuery(window.location.pathname, {
        from: previous.versionNo,
        to: versionNo,
      });
      // `navigateTo` skips a push only when its argument equals
      // `window.location.pathname`, which a target carrying a query never does
      // — so choosing the row already on screen stacked another identical
      // entry, and Back walked through indistinguishable copies of one
      // comparison before leaving the page. Compared here against the full
      // current URL, which is what actually distinguishes two comparisons.
      if (target === `${window.location.pathname}${window.location.search}`) {
        return;
      }
      navigateTo(target);
    },
    [versions, list.hasNextPage]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          aria-label={canEditDocument ? "Back to the document" : "Back"}
          onClick={() => navigateTo(backHref)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-foreground">
            Version history
          </h1>
          {documentTitle ? (
            <p className="truncate text-xs text-muted-foreground">
              {documentTitle}
            </p>
          ) : null}
        </div>
      </header>

      {/* Stacked below `lg`, side by side above it. The rail is a fixed 18rem,
          and at a 375px viewport that leaves the comparison roughly 87px before
          borders and padding — its pair description, filter and field values
          all clipped. `DashboardLayout` already switches to a mobile header at
          the same breakpoint, so the split is what has to give, not the
          content beside it. Stacked, the rail keeps a bounded height so the
          comparison is reachable without scrolling past the whole history. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="max-h-[40vh] shrink-0 overflow-y-auto border-b border-border lg:max-h-none lg:w-72 lg:border-r lg:border-b-0">
          <VersionTimelineRail
            scope={scope}
            versions={versions}
            selected={pair.kind === "pair" ? pair.to : null}
            onSelect={selectPair}
            isLoading={list.isLoading}
            // Only a failure that left NOTHING on screen replaces the rail. A
            // failed next page also flips the query to error while its loaded
            // pages remain, and passing that through discarded every row a
            // reader already had, along with the Load more control that would
            // have retried it. The history sheet draws the same distinction.
            isError={list.isError && versions.length === 0}
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
          />
        </aside>

        {/* A labelled region rather than `main`: the dashboard shell already
            provides the document's one primary landmark, and nesting a second
            makes landmark navigation announce two. */}
        <section
          aria-label="Comparison"
          className="flex min-h-0 flex-1 flex-col"
        >
          <ComparisonPane
            scope={scope}
            pair={pair}
            isError={list.isError}
            isLoading={list.isLoading}
            onRetry={() => void list.refetch()}
          />
        </section>
      </div>
    </div>
  );
}

/** The address of a document's history, with an optional pair already chosen. */
export function versionsHref(
  scope: VersionScope,
  pair?: { from: number; to: number }
): string {
  const path =
    scope.kind === "single"
      ? buildRoute(ROUTES.SINGLE_VERSIONS, { slug: scope.slug })
      : buildRoute(ROUTES.COLLECTION_ENTRY_VERSIONS, {
          slug: scope.slug,
          id: scope.entryId ?? "",
        });
  return pair ? withQuery(path, { from: pair.from, to: pair.to }) : path;
}
