/**
 * The CLI run as a shell runs it: its own entry point, from source, in a
 * process of its own, for the tests that need what only a real process does,
 * such as loading the project's configuration.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENTRY = fileURLToPath(new URL("../../nextly.ts", import.meta.url));
// The package's own path aliases, which the loader looks for beside the
// working directory, a project folder here.
const TSCONFIG = fileURLToPath(
  new URL("../../../../tsconfig.json", import.meta.url)
);
// The TypeScript loader, by its location here: a project folder has no
// `node_modules` of its own to find it in.
const TSX = pathToFileURL(
  join(
    dirname(createRequire(import.meta.url).resolve("tsx/package.json")),
    "dist/loader.mjs"
  )
).href;

/** How long one command may take: each run compiles the CLI from source. */
export const NEXTLY_RUN_TIMEOUT = 120_000;

/**
 * Runs `nextly <args>` in `cwd` with this process's environment, telemetry
 * off, and `env` over it; a variable given as `undefined` is removed.
 */
export function runNextly(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = {}
): { status: number | null; stdout: string; stderr: string } {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    NEXTLY_TELEMETRY_DISABLED: "1",
    TSX_TSCONFIG_PATH: TSCONFIG,
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete merged[name];
    else merged[name] = value;
  }
  const run = spawnSync(process.execPath, ["--import", TSX, ENTRY, ...args], {
    cwd,
    env: merged,
    encoding: "utf8",
    timeout: NEXTLY_RUN_TIMEOUT,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}
