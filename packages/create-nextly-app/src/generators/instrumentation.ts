import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

import type { GeneratedFiles } from "./generated-files";

/** Every name Next.js loads its instrumentation hook from. */
const HOOK_NAMES = [
  "instrumentation.ts",
  "instrumentation.js",
  "instrumentation.mts",
  "instrumentation.mjs",
];

/**
 * The statements that start Nextly, for a hook at `configImport` from the config.
 *
 * One spelling for both uses: the body of a hook this writes, and the lines a
 * developer adds to a hook of their own.
 */
function startNextly(configImport: string): string {
  return `  const { registerNextCacheRevalidator } = await import("nextly/runtime");
  registerNextCacheRevalidator();

  const { createRegister } = await import("nextly");
  const { default: config } = await import("${configImport}");
  await createRegister(config)();`;
}

/** The whole hook, as the blank template ships it. */
export function instrumentationHook(configImport: string): string {
  return `/**
 * Starts Nextly when the server starts, before it serves a request.
 *
 * Next.js runs \`register()\` once per server instance and finishes it before
 * the instance handles traffic, in every serverless function as well as the
 * admin's. Without it, Nextly starts on the first request that happens to
 * need it, so a route that cannot start it alone, such as \`/api/health\`,
 * answers as if the server could not serve until some other request has.
 *
 * It also registers Nextly's Next.js cache adapter here, so a Direct API write
 * from any function flushes the cache tags it touches.
 *
 * Guarded to the Node.js runtime and imported dynamically inside the guard:
 * Nextly needs Node-only packages that the Edge runtime cannot bundle. Next.js
 * skips \`register()\` during \`next build\`, so this never opens a database
 * connection at build time.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

${startNextly(configImport)}
}
`;
}

/**
 * Give an existing app the hook that starts Nextly when its server starts.
 *
 * Next.js reads the hook beside \`app/\`: in \`src/\` when the app lives there,
 * at the root otherwise. A hook that is already there belongs to the app and is
 * never rewritten; it is reported as skipped with the lines to add to its
 * \`register()\`.
 */
export async function generateInstrumentation(
  cwd: string,
  projectInfo: Pick<ProjectInfo, "srcDir">
): Promise<GeneratedFiles> {
  const dir = projectInfo.srcDir ? "src" : "";
  const configImport = projectInfo.srcDir
    ? "../nextly.config"
    : "./nextly.config";

  for (const name of HOOK_NAMES) {
    const relative = path.posix.join(dir, name);
    if (await fs.pathExists(path.join(cwd, relative))) {
      return {
        written: [],
        changed: [],
        skipped: [
          {
            path: relative,
            why: "the app already has a server-start hook, so it was left as it is",
            toAdd: `Inside register(), under the Node.js runtime only (process.env.NEXT_RUNTIME === "nodejs"):\n\n${startNextly(configImport)}`,
          },
        ],
      };
    }
  }

  const relative = path.posix.join(dir, "instrumentation.ts");
  await fs.ensureDir(path.dirname(path.join(cwd, relative)));
  await fs.writeFile(
    path.join(cwd, relative),
    instrumentationHook(configImport),
    {
      encoding: "utf-8",
      flag: "wx",
    }
  );
  return { written: [relative], changed: [], skipped: [] };
}
