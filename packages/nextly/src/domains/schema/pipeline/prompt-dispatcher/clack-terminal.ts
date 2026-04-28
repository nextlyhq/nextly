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
    const { candidates } = args;

    if (candidates.length === 0) {
      // Pure-additive apply (or all renames pre-resolved). No prompt needed.
      // F5 PR 5 will extend this dispatcher to walk args.events here when
      // candidates is empty but events exist.
      return { confirmedRenames: [], resolutions: [], proceed: true };
    }

    if (!hasTTY()) {
      // Build a short summary of the renames the user would have been asked
      // about so the error log is actionable.
      const sample = candidates
        .slice(0, 3)
        .map(c => `${c.fromColumn} -> ${c.toColumn} on ${c.tableName}`)
        .join(", ");
      const more =
        candidates.length > 3 ? `, +${candidates.length - 3} more` : "";
      throw new TTYRequiredError(
        `Schema change has ${candidates.length} rename candidate(s) needing confirmation: ${sample}${more}.`
      );
    }

    return await this.runShrinkingPoolPrompts(candidates);
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
