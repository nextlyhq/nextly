/**
 * `nextly generate:types --check`: whether the app's committed component map agrees with what
 * its config declares, for CI. Writes nothing, generates nothing, and publishes nothing.
 *
 * The verdict comes first and the exit status says it, since a gate's reader skims:
 *
 * - **0** the map agrees.
 * - **1** it does not: each missing component (with its owner, and its widget for a widget),
 *   each path no longer declared, and each file absent or unreadable, then the fix.
 * - **2** the check could not be asked: the config did not load, or a file there could not be
 *   read. Not an answer about the map, so never read as one.
 *
 * @module cli/commands/component-map-check-command
 */

import { relative, sep } from "node:path";

import { describeError } from "../../errors/index";
import {
  checkComponentMapFiles,
  componentMapAgrees,
  type ComponentMapAgreement,
} from "../../plugins/codegen/check-component-map";
import { describeComponentUse } from "../../plugins/codegen/component-import-map";
import { generatedTypesFile } from "../../shared/lib/generated-output-paths";
import type { CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";

/** The exit status of each verdict. */
export const COMPONENT_MAP_CHECK_EXIT = {
  agrees: 0,
  outOfDate: 1,
  couldNotCheck: 2,
} as const;

/**
 * Runs the check and answers its exit status; the caller exits with it.
 *
 * The map is looked for where `generate:types` writes it: beside the types file the CONFIG
 * names, not `--output`, which moves only the types file.
 */
export async function runComponentMapCheck(
  options: { config?: string; cwd?: string },
  context: CommandContext
): Promise<number> {
  const { logger } = context;
  const cwd = options.cwd ?? process.cwd();
  let found: ComponentMapAgreement;
  try {
    const loaded = await loadConfig({ configPath: options.config, cwd });
    found = await checkComponentMapFiles(
      loaded.config.plugins ?? [],
      generatedTypesFile(cwd, loaded.config.typescript.outputFile),
      cwd
    );
  } catch (error) {
    logger.error(
      `Component map: could not be checked. ${describeError(error)}`
    );
    return COMPONENT_MAP_CHECK_EXIT.couldNotCheck;
  }
  if (componentMapAgrees(found)) {
    logger.success("Component map: agrees with the config.");
    return COMPONENT_MAP_CHECK_EXIT.agrees;
  }
  for (const line of outOfDateReport(found, cwd)) logger.error(line);
  return COMPONENT_MAP_CHECK_EXIT.outOfDate;
}

/** The report of a map that disagrees: the verdict, each disagreement, then the fix. */
function outOfDateReport(found: ComponentMapAgreement, cwd: string): string[] {
  const shown = (file: string) => relative(cwd, file).split(sep).join("/");
  const [map, list] = found.files.map(shown) as [string, string];
  return [
    `Component map: OUT OF DATE (${map} and ${list}).`,
    ...found.absent.map(file => `- absent: ${shown(file)}`),
    ...(found.listReadable
      ? []
      : [`- not a list the generator writes: ${list}`]),
    ...found.missing.map(each => `- missing: ${describeComponentUse(each)}`),
    ...found.obsolete.map(path => `- no longer declared: ${path}`),
    "Run `npx nextly generate:types` and commit both files.",
  ];
}
