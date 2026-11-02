/**
 * One CLI run, from its arguments: the mode and its environment files first,
 * then the program.
 *
 * The entry point is this and nothing else, so a test that drives a command
 * through `runCli` takes the same path a shell does.
 *
 * @module cli/run
 */

import { loadCliEnvironment } from "./environment";

/**
 * Runs the CLI for `argv` (`process.argv` from the entry point).
 *
 * The environment is read before any application module is imported, and the
 * program is imported dynamically for that reason: those modules may read
 * `process.env` as they load, and a configuration evaluated by a command must
 * see the run's mode as `NODE_ENV`. Static imports would be evaluated first.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
  loadCliEnvironment(argv);

  const { createProgram } = await import("./program");
  const { reportCliError } = await import("./errors/index");
  const telemetry = await import("@nextlyhq/telemetry");

  const program = createProgram();

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    // Best-effort telemetry: capture a typed failure event with no raw
    // message or stack. Wrapped so a telemetry failure can never mask the
    // underlying user-visible error.
    try {
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
      const globals = program.opts<{ verbose?: boolean }>();
      reportCliError(error, { verbose: globals.verbose === true });
    }

    process.exit(1);
  }
}
