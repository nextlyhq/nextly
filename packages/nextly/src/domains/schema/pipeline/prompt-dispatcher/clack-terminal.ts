// F8 clack-based PromptDispatcher for the terminal channel.
//
// Replaces drizzle-kit's TUI prompt with our own clack-rendered prompt
// for column-rename ambiguities. F4 RegexRenameDetector emits Cartesian
// rename candidates (N drops x M adds = N*M candidates per table); this
// dispatcher walks the candidates in a "shrinking pool" pattern: each
// time the user picks 'rename', the consumed drop and add are removed
// from the candidate pool so subsequent prompts only show options that
// haven't been resolved yet.
//
// Non-TTY behavior: throws TTYRequiredError with actionable message.
// The intentional v1 limitation per F4 Option E plan: code-first non-TTY
// users get a clear error directing them to a TTY terminal.
//
// Browser channel ('browser'): NOT implemented in this PR. F10 will add
// SSE-based browser modal rendering. For now, channel='browser' is
// treated like channel='terminal' (terminal prompt). UI-first prompts
// don't go through this dispatcher in PR 5 - they're handled in admin UI
// before save - so this is OK.

import * as clack from "@clack/prompts";

import type {
  ClassifierEvent,
  PromptDispatcher,
  PromptDispatchResult,
  RenameCandidate,
  Resolution,
  ResolutionKind,
} from "../pushschema-pipeline-interfaces";

import { PromptCancelledError, TTYRequiredError } from "./errors";

// Re-export so callers that want to catch these errors can import from the
// dispatcher module they already depend on.
export { PromptCancelledError, TTYRequiredError };

function hasTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Power-user opt-out: skip the interactive destructive_drop prompt and
// auto-confirm every drop. Useful for CI/CD or non-interactive workflows
// where the operator already trusts the config edit and just wants the
// columns gone. Matches Drizzle Kit's --force / Prisma's
// --accept-data-loss pattern. Only affects destructive_drop events;
// other event kinds (type_change, NOT NULL) still prompt.
// Two spellings are honored: NEXTLY_ALLOW_CODE_FIRST_DROPS is the original
// env opt-in, and NEXTLY_ACCEPT_DATA_LOSS is what `db:sync
// --accept-data-loss` exports for the rest of the run.
function shouldAutoConfirmDrops(): boolean {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const allowCodeFirstDrops = process.env.NEXTLY_ALLOW_CODE_FIRST_DROPS === "1";
  const acceptDataLoss = process.env.NEXTLY_ACCEPT_DATA_LOSS === "1";
  return allowCodeFirstDrops || acceptDataLoss;
}

export class ClackTerminalPromptDispatcher implements PromptDispatcher {
  async dispatch(args: {
    candidates: RenameCandidate[];
    events: ClassifierEvent[];
    classification: "safe" | "destructive" | "interactive";
    channel: "browser" | "terminal";
  }): Promise<PromptDispatchResult> {
    const { candidates, events } = args;

    // Fast path: nothing to ask, nothing to do.
    if (candidates.length === 0 && events.length === 0) {
      return { confirmedRenames: [], resolutions: [], proceed: true };
    }

    if (!hasTTY()) {
      // Honor the drop opt-in before refusing: a non-interactive run whose
      // batch needs nothing but drop confirmations can proceed when the
      // operator opted in (mirrors the TTY pre-scan in runEventPrompts).
      // Anything needing a real decision — renames, type changes — still
      // requires a terminal below.
      if (
        candidates.length === 0 &&
        shouldAutoConfirmDrops() &&
        events.every(e => e.kind === "destructive_drop")
      ) {
        return {
          confirmedRenames: [],
          resolutions: events.map(e => ({
            kind: "confirm_drop" as const,
            eventId: e.id,
          })),
          proceed: true,
        };
      }
      // Build an actionable error message covering both renames and
      // F5/F6 events so users know what they would have been asked.
      const renameSample = candidates
        .slice(0, 3)
        .map(c => `${c.fromColumn} -> ${c.toColumn} on ${c.tableName}`)
        .join(", ");
      const eventSample = events
        .slice(0, 3)
        .map(e => {
          switch (e.kind) {
            case "type_change":
              return `type change on ${e.tableName}.${e.columnName} (${e.fromType} -> ${e.toType})`;
            case "add_not_null_with_nulls":
              return `NOT NULL on ${e.tableName}.${e.columnName}`;
            case "add_required_field_no_default":
              return `required field ${e.tableName}.${e.columnName}`;
            case "destructive_drop":
              return `drop column ${e.tableName}.${e.columnName} (${e.columnType}, ${e.tableRowCount} row(s))`;
          }
        })
        .join(", ");
      const parts: string[] = [];
      if (candidates.length > 0) {
        parts.push(`${candidates.length} rename candidate(s): ${renameSample}`);
      }
      if (events.length > 0) {
        parts.push(`${events.length} resolution event(s): ${eventSample}`);
      }
      throw new TTYRequiredError(
        // Multi-line so log readers can scan rename vs event sections
        // separately without an arbitrary semicolon-join.
        `Schema change needs confirmation.\n${parts.join("\n")}`
      );
    }

    // Phase 1: rename candidates via shrinking-pool prompt.
    const renameResult =
      candidates.length > 0
        ? await this.runShrinkingPoolPrompts(candidates)
        : {
            confirmedRenames: [],
            resolutions: [] as Resolution[],
            proceed: true,
          };
    if (!renameResult.proceed) return renameResult;

    // Phase 2: F5/F6 events.
    const eventResult = await this.runEventPrompts(events);

    return {
      confirmedRenames: renameResult.confirmedRenames,
      resolutions: eventResult.resolutions,
      proceed: eventResult.proceed,
    };
  }

  // Walk classifier events in order. NOT-NULL kinds get a multi-step
  // (select kind -> text value if provide_default -> next event); type_change
  // gets a single warning + Y/N. Any abort or cancel returns proceed=false.
  private async runEventPrompts(
    events: ClassifierEvent[]
  ): Promise<{ resolutions: Resolution[]; proceed: boolean }> {
    if (events.length === 0) {
      return { resolutions: [], proceed: true };
    }

    const resolutions: Resolution[] = [];

    // Pre-scan: when the operator has opted in to auto-confirmed drops
    // (shouldAutoConfirmDrops) AND every event in this batch is a
    // destructive_drop, skip clack entirely and auto-confirm all of them.
    // The intro/outro frame would be noise for a workflow that explicitly
    // doesn't want prompts.
    const autoConfirmDrops = shouldAutoConfirmDrops();
    const allDestructiveDrops = events.every(
      e => e.kind === "destructive_drop"
    );
    if (autoConfirmDrops && allDestructiveDrops) {
      for (const event of events) {
        if (event.kind !== "destructive_drop") continue;
        resolutions.push({ kind: "confirm_drop", eventId: event.id });
      }
      return { resolutions, proceed: true };
    }

    clack.intro("Schema change requires confirmation");

    for (const event of events) {
      if (event.kind === "destructive_drop") {
        // Mirrors Drizzle Kit's `push` destructive-confirm UX. The note
        // surfaces column type and row count so the user sees the
        // magnitude of the loss before answering.
        clack.note(
          `Type: ${event.columnType}\nRows affected: ${event.tableRowCount}`,
          `Drop column "${event.tableName}.${event.columnName}"`
        );
        // Per-drop opt-out: power users can still set the flag mid-session
        // (e.g. from .env, then HMR-restart) to skip every subsequent
        // drop prompt without touching the rename/type-change UX.
        if (autoConfirmDrops) {
          resolutions.push({ kind: "confirm_drop", eventId: event.id });
          continue;
        }
        const proceed = await clack.confirm({
          message: `Drop "${event.columnName}" from "${event.tableName}"?`,
          initialValue: false,
        });
        if (clack.isCancel(proceed) || proceed === false) {
          clack.outro("Cancelled");
          return { resolutions, proceed: false };
        }
        resolutions.push({ kind: "confirm_drop", eventId: event.id });
        continue;
      }
      if (event.kind === "type_change") {
        // Render the per-dialect warning text and ask Y/N.
        clack.note(
          [
            event.perDialectWarning.pg,
            event.perDialectWarning.mysql,
            event.perDialectWarning.sqlite,
          ].join("\n"),
          `Type change on ${event.tableName}.${event.columnName}: ${event.fromType} -> ${event.toType}`
        );
        const proceed = await clack.confirm({
          message: `Proceed with type change on ${event.tableName}.${event.columnName}?`,
          initialValue: false,
        });
        if (clack.isCancel(proceed) || proceed === false) {
          clack.outro("Cancelled");
          return { resolutions, proceed: false };
        }
        // type_change has no resolution kinds; the user has acknowledged
        // the warning. Nothing to push into resolutions[].
        continue;
      }

      // F5 NOT-NULL kinds.
      const headline =
        event.kind === "add_not_null_with_nulls"
          ? `Adding NOT NULL to "${event.tableName}.${event.columnName}"\n${event.nullCount} of ${event.tableRowCount} rows have NULL values.`
          : `New required field "${event.tableName}.${event.columnName}" on table with ${event.tableRowCount} existing rows.`;
      clack.note(headline, "Resolution needed");

      const labels: Record<ResolutionKind, string> = {
        provide_default: "Provide a default value for empty rows",
        make_optional: "Make the field optional (cancel the NOT NULL)",
        delete_nonconforming:
          event.kind === "add_not_null_with_nulls"
            ? `Delete the ${event.nullCount} rows with empty values`
            : "Delete rows that violate the constraint",
        // Unreachable for NOT-NULL kinds (destructive_drop never lists
        // these resolutions in applicableResolutions), but Record<K,V>
        // requires every key. The label only surfaces if a future event
        // erroneously includes confirm_drop in its applicableResolutions.
        confirm_drop: "Confirm the drop",
        abort: "Cancel everything",
      };
      const options = event.applicableResolutions.map(kind => ({
        value: kind,
        label: labels[kind],
      }));
      const choice = await clack.select({
        message: "How do you want to handle this?",
        options,
      });
      if (clack.isCancel(choice)) {
        clack.outro("Cancelled");
        return { resolutions, proceed: false };
      }
      const kind = choice;
      if (kind === "abort") {
        clack.outro("Cancelled");
        return { resolutions, proceed: false };
      }
      if (kind === "provide_default") {
        const value = await clack.text({
          message: `Default value for "${event.columnName}":`,
          validate: v =>
            !v || v.trim().length === 0 ? "Cannot be empty" : undefined,
        });
        if (clack.isCancel(value)) {
          clack.outro("Cancelled");
          return { resolutions, proceed: false };
        }
        resolutions.push({
          kind: "provide_default",
          eventId: event.id,
          value,
        });
      } else {
        resolutions.push({ kind, eventId: event.id });
      }
    }

    clack.outro("Resolutions confirmed");
    return { resolutions, proceed: true };
  }

  // Walks candidates in a shrinking-pool pattern:
  //   1. Group candidates by `fromColumn` (the dropped column).
  //   2. For each unique drop, ask the user to pick from its valid adds
  //      (filtered to those that haven't been consumed).
  //   3. If user picks 'rename' with a specific add, mark both the drop
  //      and the add as consumed; future prompts skip them.
  //   4. If user picks 'drop_and_add', drop survives as drop+add (no rename).
  private async runShrinkingPoolPrompts(
    candidates: RenameCandidate[]
  ): Promise<PromptDispatchResult> {
    const consumedDrops = new Set<string>();
    const consumedAdds = new Set<string>();
    const confirmed: RenameCandidate[] = [];

    // Group candidates by drop (table::fromColumn).
    const dropToOptions = new Map<string, RenameCandidate[]>();
    for (const c of candidates) {
      const key = `${c.tableName}::${c.fromColumn}`;
      const list = dropToOptions.get(key) ?? [];
      list.push(c);
      dropToOptions.set(key, list);
    }

    clack.intro("Schema rename detected");

    for (const [dropKey, options] of dropToOptions) {
      if (consumedDrops.has(dropKey)) continue;

      // Filter remaining options whose `toColumn` hasn't been consumed.
      const remaining = options.filter(c => {
        const addKey = `${c.tableName}::${c.toColumn}`;
        return !consumedAdds.has(addKey);
      });
      if (remaining.length === 0) continue; // all targets already consumed

      const first = remaining[0];

      // Build select options: each remaining ADD becomes a 'rename to X'
      // option, plus a 'drop and add new' option.
      const selectOptions: Array<{
        value: string;
        label: string;
        hint?: string;
      }> = remaining.map(c => ({
        value: `rename:${c.toColumn}`,
        label: `Rename ${c.fromColumn} -> ${c.toColumn}`,
        hint: c.typesCompatible
          ? `${c.fromType} -> ${c.toType} (data preserved)`
          : `${c.fromType} -> ${c.toType} (incompatible types; not recommended)`,
      }));
      selectOptions.push({
        value: "drop_and_add",
        label: `Drop ${first.fromColumn} and add new column(s) (data lost)`,
      });

      // Default: first compatible rename if any; otherwise drop_and_add.
      const compatible = remaining.find(c => c.typesCompatible);
      const initialValue =
        compatible !== undefined
          ? `rename:${compatible.toColumn}`
          : "drop_and_add";

      const choice = await clack.select({
        message: `Column "${first.fromColumn}" was removed in ${first.tableName}. What should happen?`,
        options: selectOptions,
        initialValue,
      });

      if (clack.isCancel(choice)) {
        clack.outro("Cancelled");
        throw new PromptCancelledError();
      }

      if (typeof choice === "string" && choice.startsWith("rename:")) {
        const targetColumn = choice.slice("rename:".length);
        const picked = remaining.find(c => c.toColumn === targetColumn);
        if (picked) {
          confirmed.push(picked);
          consumedDrops.add(dropKey);
          consumedAdds.add(`${picked.tableName}::${picked.toColumn}`);
        }
      }
      // 'drop_and_add' falls through: drop and adds remain as-is in the
      // operations list; no consumed marks added.
    }

    clack.outro("Schema renames confirmed");

    return {
      confirmedRenames: confirmed,
      resolutions: [],
      proceed: true,
    };
  }
}
