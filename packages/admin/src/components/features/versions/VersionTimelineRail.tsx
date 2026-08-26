/**
 * The version list beside a comparison.
 *
 * Newest first, each row naming its author, when it was written, and what
 * changed in it. Choosing a row compares it against the version before it,
 * which is the question a reader almost always has; the pair is then in the
 * URL, so the choice is addressable rather than a state the page happens to
 * hold.
 *
 * @module components/features/versions/VersionTimelineRail
 */

import { Badge, Button, Skeleton } from "@admin/components/ui";
import { formatDateTime } from "@admin/lib/dates/format";
import type { VersionMeta, VersionScope } from "@admin/services/versionApi";

import { predecessorOf, type Predecessor } from "./version-pairing";
import { VersionSummaryLine } from "./VersionSummaryLine";

/** How many rows fetch their summary. Beyond this a reader has to scroll. */
const SUMMARISED_ROWS = 12;

export interface VersionTimelineRailProps {
  scope: VersionScope;
  versions: readonly VersionMeta[];
  /** The newer half of the pair on screen, which marks the active row. */
  selected: number | null;
  onSelect: (versionNo: number) => void;
  isLoading?: boolean;
  /**
   * Whether the history could not be read. The pane beside this one reports the
   * failure; without this the rail would answer the same empty list with "No
   * versions yet", which is a claim about the document rather than about the
   * request.
   */
  isError?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        Loading history
      </span>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex flex-col gap-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

/** A row's first line: which version it is, its status, and any name given it. */
function RowHeading({ version }: { version: VersionMeta }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">
        {version.versionNo === null
          ? "Autosave"
          : `Version ${version.versionNo}`}
      </span>
      {version.status ? (
        <Badge variant={version.status === "published" ? "success" : "outline"}>
          {version.status}
        </Badge>
      ) : null}
      {version.label ? (
        <span className="truncate text-xs text-muted-foreground">
          {version.label}
        </span>
      ) : null}
    </span>
  );
}

/** One version in the rail. */
function TimelineRow({
  scope,
  version,
  previous,
  active,
  summarised,
  onSelect,
}: {
  scope: VersionScope;
  version: VersionMeta;
  previous: Predecessor;
  active: boolean;
  summarised: boolean;
  onSelect: (versionNo: number) => void;
}) {
  // An autosave carries no version number, so it cannot be compared and is
  // shown without being selectable rather than hidden — it is still a record of
  // the document having been touched.
  const versionNo = version.versionNo;
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        disabled={versionNo === null}
        onClick={() => versionNo !== null && onSelect(versionNo)}
        className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-60 ${
          active ? "bg-muted" : ""
        }`}
      >
        <RowHeading version={version} />
        <span className="mt-0.5 flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {version.author?.name ?? "Unknown author"} &middot;{" "}
            {formatDateTime(version.createdAt)}
          </span>
          {versionNo === null ? null : (
            <VersionSummaryLine
              scope={scope}
              versionNo={versionNo}
              previous={previous}
              enabled={summarised}
            />
          )}
        </span>
      </button>
    </li>
  );
}

export function VersionTimelineRail({
  scope,
  versions,
  selected,
  onSelect,
  isLoading = false,
  isError = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
}: VersionTimelineRailProps) {
  if (isLoading) return <RailSkeleton />;

  // A failed read leaves the list empty exactly as an empty history does, and
  // the two must not render alike: telling someone to save their first version
  // beside a pane reporting that history could not be loaded is advice that
  // would destroy nothing but would leave them believing their history is gone.
  if (isError) return null;

  if (versions.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <h3 className="text-base font-semibold text-foreground">
          No versions yet
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Saving this document will record its first version.
        </p>
      </div>
    );
  }

  return (
    <nav aria-label="Version history">
      <ul className="flex flex-col">
        {versions.map((version, index) => (
          <TimelineRow
            key={version.id}
            scope={scope}
            version={version}
            // Derived rather than read off the next row down: that row is the
            // version before this one only when both are in the same locale,
            // and at the bottom of a loaded page there may simply be no answer
            // yet. Both consumers — this row's summary and selecting it — read
            // the same result.
            previous={predecessorOf(
              versions,
              version.versionNo ?? -1,
              hasNextPage
            )}
            active={
              version.versionNo !== null && version.versionNo === selected
            }
            summarised={index < SUMMARISED_ROWS}
            onSelect={onSelect}
          />
        ))}
      </ul>

      {hasNextPage ? (
        <div className="p-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
