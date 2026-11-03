/**
 * Whether the CLI may ask a question. Every prompt asks this one function, so
 * no command waits for input it cannot get: a script, a pipe, a CI runner (even
 * one that fakes a terminal) and `--non-interactive` all get an answer from
 * flags or a refusal naming the flag, never a wait.
 *
 * @module domains/schema/migrate/can-prompt
 */

let nonInteractive = false;

/**
 * Records the run's global `--non-interactive`. The program sets it before any
 * command's action runs.
 */
export function setNonInteractive(value: boolean): void {
  nonInteractive = value;
}

/** `CI` as the tools that read it do: set unless empty, `false` or `0`. */
function inCi(): boolean {
  const value = process.env.CI;
  return (
    value !== undefined && value !== "" && value !== "false" && value !== "0"
  );
}

/**
 * A person is there to answer: stdin and stdout are both terminals,
 * `--non-interactive` was not given, and `CI` is not set.
 */
export function canPrompt(): boolean {
  return (
    !nonInteractive &&
    !inCi() &&
    Boolean(process.stdin.isTTY && process.stdout.isTTY)
  );
}

let cancelEnds = false;

/**
 * Records that a cancel (Ctrl+C) at a prompt ends the run, with exit 130. The
 * CLI's program turns it on for every `nextly` command; the app's dev server
 * (`next dev`) leaves it off, so a cancel there stops only the change it was
 * asked about and the server keeps running.
 */
export function setCancelEndsRun(value: boolean): void {
  cancelEnds = value;
}

/** Whether a cancel at a prompt ends the run (`setCancelEndsRun`). */
export function cancelEndsRun(): boolean {
  return cancelEnds;
}
