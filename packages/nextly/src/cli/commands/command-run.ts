/**
 * What a command's action resolves first: its context from the global
 * options, and its own options with the global ones it reads (`--config`,
 * `--verbose`, `--quiet`, `--cwd`).
 *
 * @module cli/commands/command-run
 */
import type { Command } from "commander";

import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../context";

/** The global options a command reads alongside its own. */
type ReadGlobals = Pick<GlobalOptions, "config" | "verbose" | "quiet" | "cwd">;

export function commandRun<T extends object>(
  cmdOptions: T,
  cmd: Command
): { context: CommandContext; options: T & ReadGlobals } {
  const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
  return {
    context: createContext(globalOpts),
    options: {
      ...cmdOptions,
      config: globalOpts.config,
      verbose: globalOpts.verbose,
      quiet: globalOpts.quiet,
      cwd: globalOpts.cwd,
    },
  };
}
