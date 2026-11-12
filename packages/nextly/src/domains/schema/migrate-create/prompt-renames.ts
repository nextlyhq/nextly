// F11 PR 3: clack-driven rename confirmation prompts for `migrate:create`.
//
// When the diff engine + RegexRenameDetector produce RenameCandidate[],
// we ask the operator to confirm each one. On accept, the orchestrator
// collapses the matching (drop_column, add_column) pair into a
// rename_column op. On decline, the pair stays as drop+add.
//
// A field-group field renamed is asked about the same way (`fieldGroupTables`): accepting
// re-keys its stored rows to the new name instead of renaming a column.
//
// Non-interactive (CI / piped stdin):
//   - Default behaviour: decline all (conservative). A declined field-group
//     rename is warned about, since no data-loss consent will name it.
//   - With `--accept-renames`: accept all (advanced; documented).

import * as p from "@clack/prompts";

import { migrationCreateCancelled } from "../../../cli/errors/areas/migrate-create";
import { answered } from "../../../cli/utils/prompt-cancelled";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";

export interface RenameDecision {
  candidate: RenameCandidate;
  accepted: boolean;
}

export interface PromptRenamesOptions {
  /**
   * Skip interactive prompts. Used in non-TTY environments (CI) or with
   * the `--accept-renames` / explicit-decline flags.
   */
  nonInteractive?: boolean;
  /**
   * Only meaningful when `nonInteractive: true`. Default = false (decline
   * all, conservative). With `--accept-renames`, set to true.
   */
  autoAccept?: boolean;
}

/**
 * The error a cancelled rename prompt once ended `migrate:create` with. A
 * cancel now ends the run with exit 130 through `promptCancelled`, so
 * `promptRenames` no longer throws it; `migrate:create` still recognises it.
 */
export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled by user.");
    this.name = "PromptCancelledError";
  }
}

/**
 * What the operator is told before answering.
 *
 * Both answers cost something once a conversion is involved, so the prompt
 * names both costs rather than only the one that follows from declining.
 * Accepting a value-changing rename rewrites the stored values; declining it
 * drops the column and loses all of them, which is why the suggested answer
 * stays `rename` — it is the smaller loss, not a safe one.
 */
function renamePromptMessage(c: RenameCandidate): string {
  if (c.fieldGroupTables !== undefined) {
    return `Detected possible field group rename: ${c.tableName}.${c.fromColumn} → ${c.tableName}.${c.toColumn}. Apply as rename? Its stored rows in ${c.fieldGroupTables.join(", ")} move to the new name (declining leaves them under "${c.fromColumn}", where nothing reads them, and "${c.toColumn}" starts empty)`;
  }
  const move = `${c.tableName}.${c.fromColumn} → ${c.tableName}.${c.toColumn}`;
  if (c.preservesValues) {
    return `Detected possible rename: ${move}. Apply as rename? (declining will treat as DROP + ADD, losing data)`;
  }
  const effect = c.valueChangeReason ?? "the stored values change";
  return `Detected possible rename: ${move} (${c.fromType} → ${c.toType}). This rename CHANGES the stored values: ${effect}. Apply as rename? (declining will treat as DROP + ADD, losing every value instead)`;
}

export async function promptRenames(
  candidates: RenameCandidate[],
  opts: PromptRenamesOptions = {}
): Promise<RenameDecision[]> {
  const decisions: RenameDecision[] = [];
  for (const c of candidates) {
    if (opts.nonInteractive) {
      const accepted = opts.autoAccept === true;
      // A declined column rename drops the column, which the data-loss consent then asks about. A
      // declined field-group rename drops nothing, so nothing else would say its rows are left
      // where nothing reads them.
      if (!accepted && c.fieldGroupTables !== undefined) {
        p.log.warn(
          `Field group ${c.tableName}.${c.fromColumn} → ${c.toColumn} is not applied as a rename: its rows in ${c.fieldGroupTables.join(", ")} stay under "${c.fromColumn}", where nothing reads them, and "${c.toColumn}" starts empty. If it is a rename, run migrate:create at a terminal to answer, or pass --accept-renames.`
        );
      }
      if (accepted && !c.preservesValues) {
        p.log.warn(
          `Accepted rename ${c.tableName}.${c.fromColumn} → ${c.toColumn} changes the stored values: ${c.valueChangeReason ?? "the stored values change"}`
        );
      }
      decisions.push({ candidate: c, accepted });
      continue;
    }
    const answer = await p.confirm({
      message: renamePromptMessage(c),
      initialValue: c.defaultSuggestion === "rename",
    });
    // Ctrl+C mid-prompt is not a decline: the run ends as interrupted, exit
    // 130, saying in the shape that no migration was written.
    if (p.isCancel(answer)) p.cancel("Cancelled by user.");
    const accepted = await answered(answer, migrationCreateCancelled());
    decisions.push({ candidate: c, accepted });
  }
  return decisions;
}
