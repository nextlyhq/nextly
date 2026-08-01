/**
 * Generate Manifest Command
 *
 * Implements `nextly generate:manifest`, which emits the block manifest on its
 * own, and `--check`, which emits nothing and reports whether the file on disk
 * is what this config would produce.
 *
 * The manifest is also written by `generate:types`, because an app generating
 * its types should not have to remember a second command. This exists for the
 * two cases that one cannot serve:
 *
 * - **CI.** A committed manifest that no longer matches the config is a lie
 *   told to every reader of the repository, and nothing else notices — the app
 *   still boots, because the runtime reads the registry rather than the file.
 *   `--check` is what turns that into a failing build.
 * - **Cost.** Generating types walks every collection, single, component and
 *   user field and writes a Zod schema per collection. The manifest needs the
 *   plugin list and nothing else, so a check that only cares about blocks
 *   should not pay for the rest.
 *
 * Both paths settle the file through the same pair of functions below, so the
 * command that checks and the command that writes cannot disagree about what
 * belongs on disk.
 *
 * @module cli/commands/generate-manifest
 *
 * @example
 * ```bash
 * # Write the manifest
 * nextly generate:manifest
 *
 * # Fail if the committed manifest is stale (CI)
 * nextly generate:manifest --check
 * ```
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";

import type { Command } from "commander";

import { describeError, NextlyError } from "../../errors/index";
import {
  assertManifestPathIsFree,
  BLOCK_MANIFEST_FILENAME,
  buildBlockManifestArtifact,
} from "../../plugins/codegen/block-manifest";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { createContext, type CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";

/**
 * What generation would leave on disk, next to what is there now.
 *
 * `null` on either side means "no manifest", which is a state in its own right
 * rather than a missing value: an app with no block plugins must have no file,
 * and a leftover from a previous run advertises blocks it cannot render.
 */
export interface BlockManifestState {
  /** Absolute path the manifest occupies, whether or not it exists. */
  path: string;
  /** What this config would write, or `null` to write nothing. */
  expected: string | null;
  /** What is on disk now, or `null` when absent. */
  actual: string | null;
}

/**
 * Resolve both sides without touching disk beyond reading.
 *
 * The path collision is refused here rather than at each caller, because the
 * apply step below DELETES by that name: a types output called
 * `blocks.manifest.json` would be removed by the cleanup branch.
 */
export async function readBlockManifestState(
  plugins: readonly PluginDefinition[],
  typesOutputPath: string,
  cwd: string
): Promise<BlockManifestState> {
  assertManifestPathIsFree(typesOutputPath);
  const artifact = buildBlockManifestArtifact(plugins, typesOutputPath);
  const path = resolve(
    cwd,
    artifact?.path ?? join(dirname(typesOutputPath), BLOCK_MANIFEST_FILENAME)
  );
  return { path, expected: artifact?.code ?? null, actual: await read(path) };
}

/**
 * Make disk agree with `expected`. Returns whether anything changed, so a
 * caller can report "already current" rather than implying it rewrote a file.
 */
export async function applyBlockManifestState(
  state: BlockManifestState
): Promise<boolean> {
  if (state.expected === state.actual) return false;
  if (state.expected === null) {
    await rm(state.path, { force: true });
    return true;
  }
  await mkdir(dirname(state.path), { recursive: true });
  await writeFile(state.path, state.expected, "utf-8");
  return true;
}

/** A one-line account of a mismatch, for a CI log read without the diff. */
export function describeManifestDrift(state: BlockManifestState): string {
  if (state.actual === null) {
    return `${state.path} is missing; this config generates one.`;
  }
  if (state.expected === null) {
    return `${state.path} exists, but this config declares no blocks. Remove it.`;
  }
  return `${state.path} does not match this config.`;
}

/**
 * The manifest on disk, or `null` only when there is genuinely no file.
 *
 * Absent and unreadable are NOT the same answer. Reading a permission error or
 * a directory as "no file" makes an existing stale manifest compare equal to
 * "there should be none", so the write command skips the removal it owes and
 * `--check` reports the tree clean while the stale file sits there. Anything
 * that is not a missing file is surfaced.
 */
async function read(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw NextlyError.invalidInput({
      message: `The block manifest at ${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** A filesystem error meaning the path holds nothing, rather than something unreadable. */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

interface GenerateManifestOptions {
  output?: string;
  check?: boolean;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

export async function runGenerateManifest(
  options: GenerateManifestOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.header(options.check ? "Check Block Manifest" : "Generate Manifest");

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
    debug: options.verbose,
  });

  const cwd = options.cwd ?? process.cwd();
  const state = await readBlockManifestState(
    configResult.config.plugins ?? [],
    options.output ?? configResult.config.typescript.outputFile,
    cwd
  );

  if (options.check) {
    if (state.expected === state.actual) {
      logger.success(
        state.expected === null
          ? "No blocks are declared, and no manifest is committed."
          : `Block manifest is current: ${state.path}`
      );
      return;
    }
    logger.error(describeManifestDrift(state));
    logger.info("Run `nextly generate:manifest` and commit the result.");
    process.exit(1);
  }

  const changed = await applyBlockManifestState(state);
  if (state.expected === null) {
    logger.success(
      changed
        ? `No blocks are declared; removed ${state.path}`
        : "No blocks are declared, and no manifest exists."
    );
    return;
  }
  logger.success(
    changed
      ? `Written block manifest → ${state.path}`
      : `Block manifest already current: ${state.path}`
  );
}

/**
 * Register the generate:manifest command with the program
 *
 * @param program - Commander program instance
 */
export function registerGenerateManifestCommand(program: Command): void {
  program
    .command("generate:manifest")
    .description(
      "Generate the block manifest from plugin declarations, or check it is current"
    )
    .option(
      "-o, --output <path>",
      "Types output path the manifest is written beside"
    )
    .option(
      "--check",
      "Write nothing; exit non-zero if the committed manifest is stale"
    )
    .action(async (cmdOptions: GenerateManifestOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      try {
        await runGenerateManifest(
          {
            ...cmdOptions,
            config: globalOpts.config,
            verbose: globalOpts.verbose,
            quiet: globalOpts.quiet,
            cwd: globalOpts.cwd,
          },
          context
        );
      } catch (error) {
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
