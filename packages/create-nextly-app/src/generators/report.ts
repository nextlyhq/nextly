import * as p from "@clack/prompts";

import type { GeneratedFiles } from "./generated-files";

/**
 * The one report a run that adds Nextly to an existing app ends with: every
 * file written, every file extended and with what, and every file left alone
 * with why and what to add by hand, across all the steps, then the warnings.
 *
 * Paths, keys and packages only: a value, the generated secret among them,
 * never reaches the terminal, because no step puts one in what it reports.
 */
export function reportGeneratedFiles(
  reported: readonly GeneratedFiles[],
  warnings: readonly string[] = []
): void {
  for (const written of reported.flatMap(files => files.written)) {
    p.log.info(`Wrote ${written}`);
  }
  for (const { path, added } of reported.flatMap(files => files.changed)) {
    p.log.info(`Updated ${path}: ${added.join(", ")}`);
  }
  for (const { path, why, toAdd } of reported.flatMap(files => files.skipped)) {
    p.log.warn(`Left ${path} as it was: ${why}`);
    if (toAdd) p.log.message(toAdd);
  }
  for (const warning of warnings) p.log.warn(warning);
}
