/**
 * The declarations of `nextly workflow:stranded` and
 * `nextly workflow:move-stranded`: their options and help, with the actions
 * loaded from `./workflow-stranded` only when a command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** Register `nextly workflow:stranded` and `nextly workflow:move-stranded`. */
export function registerWorkflowStrandedCommands(program: Command): void {
  program
    .command("workflow:stranded")
    .description("List documents in a workflow stage that no longer exists")
    .option("--collection <slug>", "Only this collection's documents")
    .option("--single <slug>", "Only this Single's document")
    .action(
      lazyAction(
        async () => (await import("./workflow-stranded")).workflowStrandedAction
      )
    );

  // A move writes every document it names, so it offers the dry run every writing command does.
  const moveStranded = program
    .command("workflow:move-stranded")
    .description(
      "Move documents in a workflow stage that no longer exists to a named stage, recording each move"
    )
    .requiredOption("--to <stage>", "The stage to move them to")
    .requiredOption(
      "--as <email>",
      "The email of the person each move is recorded as"
    )
    .requiredOption(
      "--comment <why>",
      "Why they are moved, kept with each move"
    )
    .option("--collection <slug>", "Only this collection's documents")
    .option("--single <slug>", "Only this Single's document");
  withDryRun(moveStranded).action(
    lazyAction(
      async () =>
        (await import("./workflow-stranded")).workflowMoveStrandedAction
    )
  );
}
