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
import { resolve, dirname, join, relative, sep } from "node:path";

import type { Command } from "commander";

import { NextlyError } from "../../errors/index";
import {
  assertManifestPathIsFree,
  BLOCK_MANIFEST_FILENAME,
  buildBlockManifestArtifact,
} from "../../plugins/codegen/block-manifest";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { generatedTypesFile } from "../../shared/lib/generated-output-paths";
import { reportDryRun, type DryRunChange } from "../dry-run";
import { exitWithError } from "../errors";
import { blockManifestStale } from "../errors/areas/commands";
import { createContext, type CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";
import type { Logger } from "../utils/logger";

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

/** What making disk agree with `expected` does to the manifest. */
type BlockManifestChange =
  | { action: "write"; code: string }
  | { action: "remove" };

/**
 * The change that makes disk agree with `expected`: write it, remove it, or
 * `undefined` when it already agrees. The one decision both the apply step and
 * a dry run's report are made from, so the two cannot disagree.
 */
function blockManifestChange(
  state: BlockManifestState
): BlockManifestChange | undefined {
  if (state.expected === state.actual) return undefined;
  return state.expected === null
    ? { action: "remove" }
    : { action: "write", code: state.expected };
}

/**
 * Make disk agree with `expected`. Returns whether anything changed, so a
 * caller can report "already current" rather than implying it rewrote a file.
 */
export async function applyBlockManifestState(
  state: BlockManifestState
): Promise<boolean> {
  const change = blockManifestChange(state);
  if (change === undefined) return false;
  if (change.action === "remove") {
    await rm(state.path, { force: true });
    return true;
  }
  await mkdir(dirname(state.path), { recursive: true });
  await writeFile(state.path, change.code, "utf-8");
  return true;
}

/**
 * The change a dry run names for the manifest: the one the apply step would
 * make, or none when the file already agrees.
 */
export function blockManifestDryRunChanges(
  state: BlockManifestState,
  cwd: string
): DryRunChange[] {
  const change = blockManifestChange(state);
  return change === undefined
    ? []
    : [{ action: change.action, target: shownPath(cwd, state.path) }];
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
    const detail = error instanceof Error ? error.message : String(error);
    // The reason and the parts apart, so a command's error can say what and why separately.
    throw NextlyError.invalidInput({
      message: `The block manifest at ${path} could not be read: ${detail}`,
      logContext: { reason: "block-manifest-unreadable", path, detail },
    });
  }
}

/**
 * A path as a dry run names it: relative to the project, "/"-separated, as
 * the developer would type it there.
 */
export function shownPath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/");
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
  /** Report the write or removal the run would make, and make none. */
  dryRun?: boolean;
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
  // Beside the types file, so fitted to the app's layout as that file is.
  const state = await readBlockManifestState(
    configResult.config.plugins ?? [],
    generatedTypesFile(
      cwd,
      options.output ?? configResult.config.typescript.outputFile
    ),
    cwd
  );

  if (options.check) {
    checkBlockManifest(state, logger);
    return;
  }

  if (options.dryRun) {
    reportDryRun(logger, { changes: blockManifestDryRunChanges(state, cwd) });
    return;
  }

  await settleBlockManifest(state, logger);
}

/** `--check`: say the manifest is current, or end the run naming the drift. */
function checkBlockManifest(state: BlockManifestState, logger: Logger): void {
  if (blockManifestChange(state) === undefined) {
    logger.success(
      state.expected === null
        ? "No blocks are declared, and no manifest is committed."
        : `Block manifest is current: ${state.path}`
    );
    return;
  }
  exitWithError(logger, blockManifestStale(describeManifestDrift(state)));
}

/** Make disk agree with the config, and say what that did. */
async function settleBlockManifest(
  state: BlockManifestState,
  logger: Logger
): Promise<void> {
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

/** The action of `nextly generate:manifest`, loaded when it runs. */
export async function generateManifestAction(
  cmdOptions: GenerateManifestOptions,
  cmd: Command
) {
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
    exitWithError(context.logger, error);
  }
}
