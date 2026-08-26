/**
 * What changed in a version, in a few words.
 *
 * One component rather than one per surface: the comparison page's rail and the
 * history panel ask exactly the same question, and two answers to it would
 * agree on the day they were written and drift after — silently, because each
 * would look right beside its own list.
 *
 * The summary is DERIVED from the comparison, never stored. Persisting it at
 * capture time would need a schema migration and would hold a value that goes
 * stale the moment the schema changes underneath it, so the field names it
 * lists could name fields that no longer exist.
 *
 * @module components/features/versions/VersionSummaryLine
 */

import { useVersionDiff } from "@admin/hooks/queries/useVersions";
import type { VersionScope } from "@admin/services/versionApi";

/** How many field names are listed before the rest are counted instead. */
const NAMED_FIELDS = 3;

export interface VersionSummaryLineProps {
  scope: VersionScope;
  /** The version being summarised. */
  versionNo: number;
  /**
   * The version it is compared against — the next-older one in the same locale.
   * Null for the oldest version, which has nothing to be compared with and is
   * described as the first record rather than as a change.
   */
  previousVersionNo: number | null;
  /**
   * Whether to fetch. A long history would otherwise issue one comparison
   * request per row on mount, so a caller fetches only for the rows a reader
   * can actually see.
   */
  enabled?: boolean;
}

/** The field labels a comparison reports as changed, in the order it gives them. */
function changedLabels(fields: readonly { label?: string; name: string }[]) {
  return fields.map(field => field.label || field.name);
}

export function VersionSummaryLine({
  scope,
  versionNo,
  previousVersionNo,
  enabled = true,
}: VersionSummaryLineProps) {
  const diff = useVersionDiff({
    scope,
    from: previousVersionNo,
    to: versionNo,
    modifiedOnly: true,
    enabled: enabled && previousVersionNo !== null,
  });

  if (previousVersionNo === null) {
    return (
      <span className="text-xs text-muted-foreground">
        The first recorded version
      </span>
    );
  }

  // Silent while unknown rather than guessing. A row that says "1 field
  // changed" and then corrects itself is worse than a row that says nothing
  // for a moment.
  if (diff.isLoading || diff.isError || !diff.data) return null;

  const labels = changedLabels(diff.data.fields);
  if (labels.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No fields changed</span>
    );
  }

  const named = labels.slice(0, NAMED_FIELDS);
  const remaining = labels.length - named.length;
  return (
    <span className="text-xs text-muted-foreground">
      {named.join(", ")}
      {remaining > 0 ? ` +${remaining} more` : ""}
    </span>
  );
}
