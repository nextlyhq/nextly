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
  PromptDispatcher,
  PromptDispatchResult,
  RenameCandidate,
  Resolution,
} from "../pushschema-pipeline-interfaces.js";

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
  action: "provide_default" | "mark_nullable" | "cancel";
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

    if (candidates.length === 0) {
      // No rename ambiguities, but events may still need resolution
      // (e.g. NOT-NULL on a populated column with the user's pre-confirmed
      // resolution attached).
      return Promise.resolve({
        confirmedRenames: [],
        resolutions: mergedEventResolutions,
        proceed: true,
      });
    }

    // Index resolutions by (table, from, to) so we can match them to
    // each candidate. Entries with choice "drop_and_add" are silently
    // dropped — they're equivalent to "no resolution attached," which
    // means applyResolutionsToOperations leaves the drop+add as-is.
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

    // Sibling-table safety: the preview endpoint only computes rename
    // candidates for the table being saved, but the apply path runs
    // diff over EVERY managed table in the desired snapshot. A candidate
    // we never had a resolution for falls through here as drop_and_add,
    // which means a column on a sibling table can be silently dropped if
    // it drifted out of band (e.g. partial migration, manual DDL). Log
    // a warning so the unexpected drop is at least observable. Each
    // unresolved candidate represents at most one column of data loss
    // on a table the user did not directly edit.
    const unresolved = candidates.filter(
      c => !knownKeys.has(`${c.tableName}::${c.fromColumn}::${c.toColumn}`)
    );
    if (unresolved.length > 0) {
      const sample = unresolved
        .slice(0, 3)
        .map(c => `${c.fromColumn} -> ${c.toColumn} on ${c.tableName}`)
        .join(", ");
      const more =
        unresolved.length > 3 ? `, +${unresolved.length - 3} more` : "";
      console.warn(
        `[BrowserPromptDispatcher] ${unresolved.length} rename candidate(s) ` +
          `had no resolution and will fall through as drop_and_add: ${sample}${more}. ` +
          `This usually means a sibling table drifted out of band; consider ` +
          `re-syncing the registry or applying changes through the affected collection's editor.`
      );
    }

    return Promise.resolve({
      confirmedRenames,
      resolutions: mergedEventResolutions,
      proceed: true,
    });
  }
}

// Translates legacy admin-dialog per-field resolutions to typed Resolution[]
// by matching field names to pipeline events on the user's table.
// - mark_nullable -> make_optional
// - cancel        -> abort
// - provide_default -> provide_default (with value)
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
    }
  }
  return out;
}
