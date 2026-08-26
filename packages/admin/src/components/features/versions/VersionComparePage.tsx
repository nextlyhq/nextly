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
import { useVersions } from "@admin/hooks/queries/useVersions";
import { navigateTo } from "@admin/lib/navigation";
import type { VersionScope } from "@admin/services/versionApi";

import { VersionDiffView } from "./diff/VersionDiffView";
import { resolvePair } from "./version-search-params";
import { VersionTimelineRail } from "./VersionTimelineRail";

export interface VersionComparePageProps {
  scope: VersionScope;
  /** Where the back control returns to — the document this history belongs to. */
  documentHref: string;
  /** The document's title, so the page says which document it is about. */
  documentTitle?: string;
  /** The pair from the URL. Either may be absent on a link that names none. */
  from?: number;
  to?: number;
}

export function VersionComparePage({
  scope,
  documentHref,
  documentTitle,
  from,
  to,
}: VersionComparePageProps) {
  const list = useVersions({ scope });

  // Autosave rows carry a null `versionNo` and cannot be compared, so they are
  // not offered as either half of a pair.
  const versions = useMemo(
    () => list.data?.pages.flatMap(page => page.items) ?? [],
    [list.data]
  );
  const comparable = useMemo(
    () =>
      versions
        .map(version => version.versionNo)
        .filter((n): n is number => n !== null),
    [versions]
  );

  const pair = resolvePair(comparable, from, to);

  // Choosing a row compares it against the version before it, and writes that
  // choice to the URL so the comparison on screen is the one the address names.
  const selectPair = useCallback(
    (versionNo: number) => {
      const index = comparable.indexOf(versionNo);
      const previous = index >= 0 ? comparable[index + 1] : undefined;
      if (previous === undefined) return;
      navigateTo(
        withQuery(window.location.pathname, { from: previous, to: versionNo })
      );
    },
    [comparable]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Back to the document"
          onClick={() => navigateTo(documentHref)}
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

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border">
          <VersionTimelineRail
            scope={scope}
            versions={versions}
            selected={pair?.to ?? null}
            onSelect={selectPair}
            isLoading={list.isLoading}
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
          />
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">
          {list.isError ? (
            <div className="flex flex-col gap-3 p-4">
              <Alert variant="destructive">
                <AlertDescription>
                  This document&apos;s history could not be loaded.
                </AlertDescription>
              </Alert>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : pair === null ? (
            // One version cannot be compared with anything. Said plainly rather
            // than shown as an empty comparison, which would read as "nothing
            // changed" — the answer this feature must never give by accident.
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {list.isLoading
                  ? "Loading history…"
                  : "There is only one version so far, so there is nothing to compare it with."}
              </p>
            </div>
          ) : (
            <VersionDiffView
              // Keyed by the pair so a different comparison mounts fresh and a
              // cached response for one pair can never paint under another's
              // heading while the new one loads.
              key={`${pair.from}-${pair.to}`}
              scope={scope}
              from={pair.from}
              to={pair.to}
            />
          )}
        </main>
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
