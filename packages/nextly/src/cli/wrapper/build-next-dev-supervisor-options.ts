// Builds the SupervisorOptions for spawning `next dev` as a child of the
// Nextly wrapper. Extracted from dev.ts so unit tests can lock in the
// cross-platform spawn shape (process.execPath + resolved JS path, not npx).

import { resolveNextBinary } from "./resolve-next-bin.js";
import type { SupervisorOptions } from "./supervisor.js";

export interface BuildNextDevSupervisorOptionsInput {
  cwd: string;
  port: string;
  env: NodeJS.ProcessEnv;
  onExit: SupervisorOptions["onExit"];
}

export function buildNextDevSupervisorOptions(
  input: BuildNextDevSupervisorOptionsInput
): SupervisorOptions {
  // Throws NextBinaryNotFoundError if next isn't installed in the user's
  // project. Caller (dev.ts) catches and surfaces it with a clean message
  // instead of letting the wrapper crash.
  const nextBin = resolveNextBinary(input.cwd);

  return {
    // Spawn `node` directly with the resolved JS path. Avoids npx, PATH
    // lookup, and the Windows `.cmd` shim issue entirely. process.execPath
    // is always an absolute path to the running Node binary on every OS.
    command: process.execPath,
    args: [nextBin, "dev", "-p", input.port],
    cwd: input.cwd,
    env: input.env,
    onExit: input.onExit,
  };
}
