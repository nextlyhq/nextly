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
 * F11 PR 3 review fix #3: typed error thrown when the operator cancels
 * a prompt mid-flow (Ctrl-C). The CLI catches this and calls
 * `process.exit(1)`. Keeping the exit out of the domain layer makes
 * promptRenames testable without spying on `process.exit` (a Ctrl-C in
 * a unit test would otherwise terminate the test runner).
 */
export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled by user.");
    this.name = "PromptCancelledError";
  }
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
      // User pressed Ctrl-C mid-prompt. Throw the typed error; the CLI
      // entry point catches and exits.
      p.cancel("Cancelled by user.");
      throw new PromptCancelledError();
    }
    decisions.push({ candidate: c, accepted: answer });
  }
  return decisions;
}
