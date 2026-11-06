/**
 * A cancelled prompt, as every prompt the CLI asks ends on one: the run stops
 * with exit 130, the status a shell gives a command interrupted by Ctrl+C. A
 * cancel is not a no. A no keeps the outcome its command gives it; only a
 * cancel ends here.
 *
 * Each prompt library takes Ctrl+C as a key rather than a signal and reports
 * it its own way: @clack/prompts answers its cancel value (`answered`),
 * @inquirer/prompts rejects with `ExitPromptError` (`isPromptForceClosed`),
 * and readline emits `SIGINT` on its interface (`askYesInTerminal`). Each
 * comes to `promptCancelled`.
 *
 * @module cli/utils/prompt-cancelled
 */
import { createInterface } from "node:readline";

import * as clack from "@clack/prompts";

import type { CliError } from "../errors/cli-error";
import { reportCliError } from "../errors/report";

/**
 * How long a holder of the interrupt gets to end the run before it is ended
 * here. The schema locks take up to 5 s to let go, then re-raise the signal.
 */
const INTERRUPT_HANDOVER_MS = 10_000;

/**
 * Ends the run on a cancelled prompt, after printing `said` in the error shape
 * when the command has a code for what the cancel left undone.
 *
 * At a prompt the terminal is in raw mode, so Ctrl+C reached the prompt as a
 * key and never became a signal. Where something listens for that signal (a
 * held schema lock releases itself on one, then ends the run with it), the
 * signal is handed back, so the lock is let go first and the run still ends
 * as interrupted; the exit code is set to 130 for a run that ends on its own.
 * Otherwise the run exits 130 at once: nothing has changed at a prompt, so
 * there is nothing to unwind. The returned promise never settles, so a caller
 * awaiting it goes no further.
 */
export function promptCancelled(said?: CliError): Promise<never> {
  // 130 is the status of a run interrupted by Ctrl+C (128 + SIGINT), written
  // as a literal at each exit: it is no failure, which ends through the shape.
  if (said !== undefined) reportCliError(said);
  if (process.listenerCount("SIGINT") === 0) {
    return process.exit(130);
  }
  process.exitCode = 130;
  process.kill(process.pid, "SIGINT");
  // A listener that does not end the run would leave it waiting on this
  // promise for ever; the timer ends it instead.
  setTimeout(() => process.exit(130), INTERRUPT_HANDOVER_MS);
  return new Promise<never>(() => {});
}

/**
 * The answer of a @clack/prompts prompt, or the end of the run when it was
 * cancelled (`promptCancelled`, printing `said` first when given).
 */
export async function answered<T>(
  answer: T | symbol,
  said?: CliError
): Promise<T> {
  if (clack.isCancel(answer)) return promptCancelled(said);
  return answer;
}

/**
 * Whether `error` is how @inquirer/prompts reports a prompt closed by Ctrl+C.
 * Read by name: the class is `@inquirer/core`'s, which this package does not
 * depend on directly.
 */
export function isPromptForceClosed(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}

/**
 * Asks `question` at the terminal through readline and answers whether the
 * line typed was `y` or `yes`, in any case; anything else is a no. Ctrl+C
 * reaches readline as `SIGINT` on its interface, which is a cancel; with no
 * listener readline would only pause, and the question would wait for ever.
 */
export function askYesInTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>(resolve => {
    rl.on("SIGINT", () => {
      rl.close();
      void promptCancelled();
    });
    rl.question(question, typed => {
      rl.close();
      resolve(/^y(es)?$/i.test(typed.trim()));
    });
  });
}
