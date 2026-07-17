// PromptDispatcher implementation for the UI-first (admin Schema Builder)
// path. Unlike the clack terminal dispatcher, this never actually prompts:
// the admin UI's SchemaChangeDialog has already collected the user's
// rename choices BEFORE the apply HTTP request fires, and those choices
// arrive on the request body. The dispatcher's only job is to translate
// those pre-attached resolutions into the PromptDispatcher contract the
// pipeline expects.
//
// Why this exists rather than calling applyResolutionsToOperations
// directly: the pipeline's seam is PromptDispatcher.dispatch(). Reusing
// it (instead of bypassing) means the same Phase B flow runs on both
// channels, and a future F10 SSE-based browser channel can swap this
// implementation out without touching the pipeline.

import type {
  ClassifierEvent,
  DestructiveDropEvent,
  PromptDispatcher,
  PromptDispatchResult,
  RenameCandidate,
  Resolution,
} from "../pushschema-pipeline-interfaces";

// Pre-attached rename choice from the admin UI. Mirrors the shape the
// admin SchemaChangeDialog renders + posts.
export interface BrowserRenameResolution {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename" | "drop_and_add";
}

// Legacy F1 admin-dialog resolution shape. Existing admin UIs send this
// per-field (`{ fieldName: { action, value? } }`) instead of the typed
// Resolution[] contract. F5 PR 6 keeps this shape supported via a
// translator inside dispatch() so admin UIs work end-to-end without
// having to ship dialog updates first.
export interface LegacyFieldResolution {
  // "confirm_drop" acknowledges a destructive column drop for that field so
  // the apply may destroy its data; without it the drop fails closed.
  action: "provide_default" | "mark_nullable" | "cancel" | "confirm_drop";
  value?: unknown;
}
export interface LegacyResolutionsBundle {
  // The collection's tableName the user is editing — needed to construct
  // candidate eventIds for matching against pipeline events.
  tableName: string;
  byFieldName: Record<string, LegacyFieldResolution>;
}

export class BrowserPromptDispatcher implements PromptDispatcher {
  // F5 PR 6: takes rename resolutions (F4 PR 5 contract), typed event
  // resolutions (new F5/F6 contract), and optionally a legacy resolution
  // bundle from un-upgraded admin UIs. Legacy entries are translated to
  // typed Resolutions inside dispatch() once the events are visible.
  constructor(
    private readonly renameResolutions: BrowserRenameResolution[],
    private readonly eventResolutions: Resolution[] = [],
    private readonly legacy?: LegacyResolutionsBundle
  ) {}

  dispatch(args: {
    candidates: RenameCandidate[];
    events: ClassifierEvent[];
    classification: "safe" | "destructive" | "interactive";
    channel: "browser" | "terminal";
  }): Promise<PromptDispatchResult> {
    const { candidates, events } = args;

    // Filter event resolutions to those whose eventId actually appears in
    // the pipeline-emitted events. Drops stale or fabricated resolutions.
    const validEventIds = new Set(events.map(e => e.id));
    const filteredEventResolutions = this.eventResolutions.filter(r =>
      validEventIds.has(r.eventId)
    );

    // Translate legacy per-field resolutions to typed Resolution[] by
    // matching field name to the pipeline event for the same table+column.
    // Only fields with an emitted event get translated; fields without an
    // event don't need a resolution.
    const translated = this.legacy
      ? translateLegacyResolutions(this.legacy, events)
      : [];
    // Merge: typed resolutions take priority over legacy ones when both
    // target the same eventId (defends against payload duplication).
    const usedEventIds = new Set(filteredEventResolutions.map(r => r.eventId));
    const mergedEventResolutions: Resolution[] = [
      ...filteredEventResolutions,
      ...translated.filter(r => !usedEventIds.has(r.eventId)),
    ];

    // Resolve rename candidates. A "rename" choice preserves the column; a
    // "drop_and_add" choice drops it, which the request made explicitly.
    // `knownKeys` is every candidate the request resolved either way.
    const confirmedKeys = new Set(
      this.renameResolutions
        .filter(r => r.choice === "rename")
        .map(r => `${r.tableName}::${r.fromColumn}::${r.toColumn}`)
    );
    const knownKeys = new Set(
      this.renameResolutions.map(
        r => `${r.tableName}::${r.fromColumn}::${r.toColumn}`
      )
    );
    const confirmedRenames = candidates.filter(c =>
      confirmedKeys.has(`${c.tableName}::${c.fromColumn}::${c.toColumn}`)
    );

    // A candidate with no resolution at all falls through as drop_and_add and
    // destroys the `from` column's data. Its destructive_drop event was
    // filtered upstream (covered-by-candidate), so it never reaches the
    // acknowledgment gate below — treat an unresolved candidate as an
    // unacknowledged drop and fail closed. This is also the sibling-table
    // drift case: the apply path diffs EVERY managed table while preview only
    // computes candidates for the edited one, so a drifted sibling column
    // would otherwise be dropped silently.
    const unresolvedCandidates = candidates.filter(
      c => !knownKeys.has(`${c.tableName}::${c.fromColumn}::${c.toColumn}`)
    );

    // A column drop is irreversible data loss. The classifier emits one
    // destructive_drop event per column whose data will be destroyed; require
    // an explicit confirm_drop resolution for every one. An abort for the same
    // event wins over a co-present confirm_drop, so conflicting resolutions
    // fail closed rather than dropping the column and then throwing after the
    // DDL has already run (auto-committed on MySQL, non-transactional SQLite).
    const abortedDrops = new Set(
      mergedEventResolutions.filter(r => r.kind === "abort").map(r => r.eventId)
    );
    const acknowledgedDrops = new Set(
      mergedEventResolutions
        .filter(r => r.kind === "confirm_drop" && !abortedDrops.has(r.eventId))
        .map(r => r.eventId)
    );
    const unacknowledgedDrops = events.filter(
      (e): e is DestructiveDropEvent =>
        e.kind === "destructive_drop" && !acknowledgedDrops.has(e.id)
    );

    // Fail the whole apply closed when any data-losing drop was not explicitly
    // acknowledged, so the coarse request-level `confirmed` flag can never
    // authorize data loss on its own and a buggy client or agent cannot
    // silently drop a populated column.
    const proceed =
      unacknowledgedDrops.length === 0 && unresolvedCandidates.length === 0;
    if (unacknowledgedDrops.length > 0) {
      const sample = unacknowledgedDrops
        .slice(0, 3)
        .map(e => `${e.columnName} on ${e.tableName}`)
        .join(", ");
      const more =
        unacknowledgedDrops.length > 3
          ? `, +${unacknowledgedDrops.length - 3} more`
          : "";
      console.warn(
        `[BrowserPromptDispatcher] refusing apply: ${unacknowledgedDrops.length} ` +
          `destructive column drop(s) were not acknowledged: ${sample}${more}. ` +
          `Attach a confirm_drop resolution for each column to authorize the drop.`
      );
    }
    if (unresolvedCandidates.length > 0) {
      const sample = unresolvedCandidates
        .slice(0, 3)
        .map(c => `${c.fromColumn} -> ${c.toColumn} on ${c.tableName}`)
        .join(", ");
      const more =
        unresolvedCandidates.length > 3
          ? `, +${unresolvedCandidates.length - 3} more`
          : "";
      console.warn(
        `[BrowserPromptDispatcher] refusing apply: ${unresolvedCandidates.length} ` +
          `rename candidate(s) had no resolution and would drop a column as ` +
          `drop_and_add: ${sample}${more}. This usually means a sibling table ` +
          `drifted out of band; re-sync the registry, apply through the affected ` +
          `collection's editor, or send an explicit rename/drop_and_add choice.`
      );
    }

    return Promise.resolve({
      confirmedRenames,
      resolutions: mergedEventResolutions,
      proceed,
    });
  }
}

// Translates legacy admin-dialog per-field resolutions to typed Resolution[]
// by matching field names to pipeline events on the user's table.
// - mark_nullable -> make_optional
// - cancel        -> abort
// - provide_default -> provide_default (with value)
// - confirm_drop  -> confirm_drop (only for a destructive_drop event)
// Fields without a matching emitted event are dropped (no resolution needed).
function translateLegacyResolutions(
  bundle: LegacyResolutionsBundle,
  events: ClassifierEvent[]
): Resolution[] {
  const out: Resolution[] = [];
  // Group events on the user's table by columnName for O(1) lookup.
  const eventByColumn = new Map<string, ClassifierEvent>();
  for (const event of events) {
    if (event.tableName !== bundle.tableName) continue;
    eventByColumn.set(event.columnName, event);
  }

  for (const [fieldName, legacy] of Object.entries(bundle.byFieldName)) {
    const event = eventByColumn.get(fieldName);
    if (!event) continue;

    if (legacy.action === "provide_default") {
      out.push({
        kind: "provide_default",
        eventId: event.id,
        value: legacy.value,
      });
    } else if (legacy.action === "mark_nullable") {
      out.push({ kind: "make_optional", eventId: event.id });
    } else if (legacy.action === "cancel") {
      out.push({ kind: "abort", eventId: event.id });
    } else if (
      legacy.action === "confirm_drop" &&
      event.kind === "destructive_drop"
    ) {
      // Only a destructive_drop can be confirmed for drop; a confirm_drop
      // aimed at any other event kind is ignored rather than producing a
      // resolution the pipeline cannot apply.
      out.push({ kind: "confirm_drop", eventId: event.id });
    }
  }
  return out;
}
