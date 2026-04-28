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
} from "../pushschema-pipeline-interfaces.js";

import { PromptCancelledError, TTYRequiredError } from "./errors.js";

// Re-export so callers that want to catch these errors can import from the
// dispatcher module they already depend on.
export { PromptCancelledError, TTYRequiredError };

function hasTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
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
      // Build an actionable error message covering both renames and
      // F5/F6 events so users know what they would have been asked.
      const renameSample = candidates
        .slice(0, 3)
        .map(c => `${c.fromColumn} -> ${c.toColumn} on ${c.tableName}`)
        .join(", ");
      const eventSample = events
        .slice(0, 3)
        .map(e =>
          e.kind === "type_change"
            ? `type change on ${e.tableName}.${e.columnName} (${e.fromType} -> ${e.toType})`
            : `${e.kind === "add_not_null_with_nulls" ? "NOT NULL on" : "required field"} ${e.tableName}.${e.columnName}`
        )
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

    clack.intro("Schema change requires confirmation");

    for (const event of events) {
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
