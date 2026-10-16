import * as p from "@clack/prompts";

import type { EnvGenerationResult } from "../types";

/**
 * Says what the env generator wrote, extended and left for the person to fix.
 * File names and key names only: an env value never reaches the terminal.
 */
export function reportEnvFiles({ files, warnings }: EnvGenerationResult): void {
  for (const name of files.written) p.log.info(`Wrote ${name}`);
  for (const { path: name, added } of files.changed) {
    p.log.info(`Added ${added.join(", ")} to ${name}`);
  }
  for (const { path: name, why, toAdd } of files.skipped) {
    p.log.warn(
      toAdd
        ? `Left ${name} as it is: ${why}. Add this to it:`
        : `Left ${name} as it is: ${why}.`
    );
    if (toAdd) p.log.message(toAdd);
  }
  for (const warning of warnings) p.log.warn(warning);
}
