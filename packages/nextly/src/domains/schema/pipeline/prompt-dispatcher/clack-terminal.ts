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

import { NextlyError } from "../../../../errors/nextly-error";
import { consoleLogger } from "../../../../shared/types";
import {
  deprecationNotices,
  judgeDataLoss,
  resolveDataLossConsent,
  type Deletion,
} from "../../migrate/data-loss-consent";
import { nonEmptyValuesOf } from "../classifier/classifier";
import type {
  ClassifierEvent,
  DestructiveDropEvent,
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

/**
 * The columns whose rename candidates were answered "drop and add": each
 * candidate's source column that no confirmed rename consumed, once.
 */
function keptDrops(
  candidates: readonly RenameCandidate[],
  confirmed: readonly RenameCandidate[]
): Deletion[] {
  const renamed = new Set(
    confirmed.map(c => `${c.tableName}::${c.fromColumn}`)
  );
  const kept = new Map<string, Deletion>();
  for (const c of candidates) {
    const key = `${c.tableName}::${c.fromColumn}`;
    if (renamed.has(key) || kept.has(key)) continue;
    kept.set(key, { kind: "column", table: c.tableName, column: c.fromColumn });
  }
  return [...kept.values()];
}

function isDrop(event: ClassifierEvent): event is DestructiveDropEvent {
  return event.kind === "destructive_drop";
}

/** Asks at the terminal, defaulting to no; a cancelled prompt is a no. */
async function askInTerminal(question: string): Promise<boolean> {
  const answer = await clack.confirm({
    message: question,
    initialValue: false,
  });
  return !clack.isCancel(answer) && answer;
}

export class ClackTerminalPromptDispatcher implements PromptDispatcher {
  /**
   * `print` writes the data-loss listing and notices; a test collects them.
   */
  constructor(
    private readonly print: (line: string) => void = line =>
      consoleLogger.warn(line)
  ) {}

  /**
   * The column drops judged by the data-loss consent (`NEXTLY_ACCEPT_DATA_LOSS`,
   * which `db:sync --accept-data-loss` sets for its run, or the earlier
   * `NEXTLY_ALLOW_CODE_FIRST_DROPS`): their confirmations when covered or
   * agreed to at the terminal, null when the terminal says no. A drop the
   * consent does not cover is refused, naming it, before any DDL: with no
   * terminal by a `TTYRequiredError` that names the consent covering it,
   * and under a consent naming other targets by a refusal of its own.
   *
   * `chosen` are the columns a rename prompt was answered "drop and add" for:
   * their drops stay in the plan without an event of their own, so they are
   * judged here too. The answer agreed to them, unless the consent names its
   * targets, which then has to cover them like any other drop.
   */
  private async judgeDrops(
    drops: readonly DestructiveDropEvent[],
    interactive: boolean,
    chosen: readonly Deletion[] = []
  ): Promise<Resolution[] | null> {
    if (drops.length === 0 && chosen.length === 0) return [];
    const consent = resolveDataLossConsent({
      env: process.env,
      honours: ["NEXTLY_ALLOW_CODE_FIRST_DROPS"],
    });
    for (const notice of deprecationNotices(consent)) this.print(notice);
    const named = consent.given !== null && consent.given.targets !== "all";
    const verdict = await judgeDataLoss({
      deletions: [
        ...drops.map(drop => ({
          kind: "column" as const,
          table: drop.tableName,
          column: drop.columnName,
          count: nonEmptyValuesOf(drop),
        })),
        ...chosen,
      ],
      consent,
      approved: named ? [] : chosen,
      interactive,
      ask: askInTerminal,
      print: this.print,
      // A push from `next dev` has no command line to pass a flag on; the
      // variable reaches both it and `db:sync`.
      flag: false,
    });
    if (verdict.kind === "declined") return null;
    if (verdict.kind === "refused") {
      if (verdict.reason === "needs-consent") {
        throw new TTYRequiredError(verdict.message);
      }
      throw NextlyError.invalidInput({
        message: verdict.message,
        logContext: { reason: "data-loss-not-covered" },
      });
    }
    return drops.map(drop => ({
      kind: "confirm_drop" as const,
      eventId: drop.id,
    }));
  }

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
      // A batch of nothing but column drops is the data-loss consent's to
      // judge: applied when covered, refused at once, naming the consent
      // that covers it, when not. Anything needing a real decision —
      // renames, type changes — still requires a terminal below.
      if (candidates.length === 0 && events.every(isDrop)) {
        return {
          confirmedRenames: [],
          resolutions:
            (await this.judgeDrops(events.filter(isDrop), false)) ?? [],
          proceed: true,
        };
      }
      // Build an actionable error message covering both renames and
      // F5/F6 events so users know what they would have been asked.
      // Both samples name what was omitted. A list that shows three of ten with no
      // ellipsis reads as complete, and this message exists to tell someone what they
      // would have been asked to approve — so a silent truncation withholds exactly the
      // inventory it was written to deliver. `browser.ts` already reports its remainder
      // this way; this matches it.
      const SAMPLE_SIZE = 3;
      const remainder = (total: number) =>
        total > SAMPLE_SIZE ? `, +${total - SAMPLE_SIZE} more` : "";
      const renameSample = candidates
        .slice(0, SAMPLE_SIZE)
        .map(c => `${c.fromColumn} -> ${c.toColumn} on ${c.tableName}`)
        .join(", ");
      const eventSample = events
        .slice(0, SAMPLE_SIZE)
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
      // The destructive subset is called out separately: a reader who sees "54 more"
      // still cannot tell whether drops are hiding in the tail, and a drop is the only
      // kind of hidden item that loses data.
      const hiddenDrops = events
        .slice(SAMPLE_SIZE)
        .filter(e => e.kind === "destructive_drop").length;
      const parts: string[] = [];
      if (candidates.length > 0) {
        parts.push(
          `${candidates.length} rename candidate(s): ${renameSample}${remainder(candidates.length)}`
        );
      }
      if (events.length > 0) {
        const drops =
          hiddenDrops > 0 ? ` (${hiddenDrops} of them column drops)` : "";
        parts.push(
          `${events.length} resolution event(s): ${eventSample}${remainder(events.length)}${drops}`
        );
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

    // Phase 2: F5/F6 events, with the drops the rename answers kept.
    const eventResult = await this.runEventPrompts(
      events,
      keptDrops(candidates, renameResult.confirmedRenames)
    );

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
    events: ClassifierEvent[],
    chosen: readonly Deletion[] = []
  ): Promise<{ resolutions: Resolution[]; proceed: boolean }> {
    if (events.length === 0 && chosen.length === 0) {
      return { resolutions: [], proceed: true };
    }

    // Every drop is listed, with what each column holds, and asked about
    // once, before any other question: the operator sees all that would be
    // lost before agreeing to any of it. Covered by consent, it is listed
    // and confirmed without asking.
    const drops = await this.judgeDrops(events.filter(isDrop), true, chosen);
    if (drops === null) return { resolutions: [], proceed: false };
    const resolutions: Resolution[] = [...drops];
    const others = events.filter(event => !isDrop(event));
    if (others.length === 0) return { resolutions, proceed: true };

    clack.intro("Schema change requires confirmation");

    for (const event of others) {
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
        // Three answers, not two. A compatible pair can still CONVERT its
        // values — `numeric` to `float8` is the pair that made the difference
        // matter — and calling that "data preserved" is the claim this hint
        // used to make.
        hint: !c.typesCompatible
          ? `${c.fromType} -> ${c.toType} (incompatible types; not recommended)`
          : c.preservesValues
            ? `${c.fromType} -> ${c.toType} (data preserved)`
            : `${c.fromType} -> ${c.toType} (rows kept, VALUES CHANGE: ${c.valueChangeReason})`,
      }));
      selectOptions.push({
        value: "drop_and_add",
        label: `Drop ${first.fromColumn} and add new column(s) (data lost)`,
      });

      // Default to a rename that PRESERVES the values before one that merely
      // fits: pre-selecting a conversion that rewrites every row is the
      // decision being taken for the author, and it is the one they would
      // most want to make themselves.
      const preserving = remaining.find(
        c => c.typesCompatible && c.preservesValues
      );
      const compatible = preserving ?? remaining.find(c => c.typesCompatible);
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
