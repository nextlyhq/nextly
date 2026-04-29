// F11 PR 3: clack-driven rename confirmation prompts for `migrate:create`.
//
// When the diff engine + RegexRenameDetector produce RenameCandidate[],
// we ask the operator to confirm each one. On accept, the orchestrator
// collapses the matching (drop_column, add_column) pair into a
// rename_column op. On decline, the pair stays as drop+add.
//
// Non-interactive (CI / piped stdin):
//   - Default behaviour: decline all (conservative).
//   - With `--accept-renames`: accept all (advanced; documented).

import * as p from "@clack/prompts";

import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces.js";

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

export async function promptRenames(
  candidates: RenameCandidate[],
  opts: PromptRenamesOptions = {}
): Promise<RenameDecision[]> {
  const decisions: RenameDecision[] = [];
  for (const c of candidates) {
    if (opts.nonInteractive) {
      decisions.push({ candidate: c, accepted: opts.autoAccept === true });
      continue;
    }
    const answer = await p.confirm({
      message: `Detected possible rename: ${c.tableName}.${c.fromColumn} → ${c.tableName}.${c.toColumn}. Apply as rename? (declining will treat as DROP + ADD, losing data)`,
      initialValue: c.defaultSuggestion === "rename",
    });
    if (p.isCancel(answer)) {
      // User pressed Ctrl-C mid-prompt. Surface as exit 1 — the
      // orchestrator catches and exits cleanly. We log here so the
      // user sees a clear "cancelled" signal before exit.
      p.cancel("Cancelled by user.");
      process.exit(1);
    }
    decisions.push({ candidate: c, accepted: answer });
  }
  return decisions;
}
