/**
 * One CLI run, from its arguments: the program, which reads the mode and its
 * environment files just before a command's action, and loads that command's
 * work after them.
 *
 * The entry point is this and nothing else, so a test that drives a command
 * through `runCli` takes the same path a shell does.
 *
 * @module cli/run
 */

import { loadProgramEnvironment } from "./environment";
import { createProgram } from "./program";

/**
 * Runs the CLI for `argv` (`process.argv` from the entry point).
 *
 * The program declares every command without loading its work. The mode and
 * the environment files are read in its `preAction` hook (`beforeAction`),
 * which only a command's action reaches, and before that command's work is
 * imported: that code may read `process.env` as it loads, and a configuration
 * it evaluates must see the run's mode as `NODE_ENV`. `--help`, `--version`
 * and an unknown command read neither. The error reporting is imported only
 * for a run that fails.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
  const program = createProgram({ beforeAction: loadProgramEnvironment });

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    // Best-effort telemetry: capture a typed failure event with no raw
    // message or stack. Wrapped so a telemetry failure can never mask the
    // underlying user-visible error.
    try {
      const telemetry = await import("@nextlyhq/telemetry");
      telemetry.capture("command_failed", {
        command: argv[2] ?? "unknown",
        duration_ms: 0,
        error_code: telemetry.classifyError(error, "other"),
      });
      await telemetry.shutdown();
    } catch {
      // Swallow.
    }

    // Commander's own errors (a missing argument, an unknown option) were already printed by
    // Commander, with its help hint; anything else is printed in the error shape, with the
    // run's `--verbose`.
    const commanderError =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("commander.");
    if (!commanderError) {
      const { reportCliError } = await import("./errors/index");
      const globals = program.opts<{ verbose?: boolean }>();
      reportCliError(error, { verbose: globals.verbose === true });
    }

    process.exit(1);
  }
}
