import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

import type { GeneratedFiles } from "./generated-files";
import { writeNew } from "./write-new";

/**
 * The names Next.js loads its instrumentation hook from: `instrumentation`
 * with one of its default page extensions, the same list it reads routes by.
 * An app that sets `pageExtensions` is handled apart, below.
 */
const HOOK_NAMES = [
  "instrumentation.ts",
  "instrumentation.tsx",
  "instrumentation.js",
  "instrumentation.jsx",
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

/** The files Next.js reads its own config from, in the order it looks. */
const NEXT_CONFIG_NAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
  "next.config.cjs",
];

/** The text of the app's Next.js config, or null when it has none. */
async function readNextConfig(
  cwd: string
): Promise<{ name: string; text: string } | null> {
  for (const name of NEXT_CONFIG_NAMES) {
    const file = path.join(cwd, name);
    if (await fs.pathExists(file)) {
      return { name, text: await fs.readFile(file, "utf-8") };
    }
  }
  return null;
}

/**
 * What to add to a hook the app already has. Written as the whole function,
 * because the statements await: a `register()` that is not `async` has to
 * become so, and saying it in code is the version that cannot be pasted wrong.
 */
function linesToAdd(configImport: string): string {
  return `Make register() async if it is not, and add Nextly's start inside it:

export async function register() {
  // ...what the hook already does...

  if (process.env.NEXT_RUNTIME === "nodejs") {
${startNextly(configImport)
  .split("\n")
  .map(line => (line ? `  ${line}` : line))
  .join("\n")}
  }
}`;
}

/**
 * Give an existing app the hook that starts Nextly when its server starts.
 *
 * Next.js reads the hook beside \`app/\`: in \`src/\` when the app lives there,
 * at the root otherwise. A hook that is already there belongs to the app and is
 * never rewritten; it is reported as skipped with what to add. So is the case
 * where the app sets \`pageExtensions\`: Next.js then reads the hook only under a
 * name with one of those extensions, which this does not guess. The config file
 * itself is never edited here. Next.js 14 runs the hook only with
 * `experimental.instrumentationHook`, which the Next config step gives in the
 * same `experimental` object as Nextly's packages (`patchNextConfig`), so two
 * steps never hand the developer two objects for one key.
 */
export async function generateInstrumentation(
  cwd: string,
  projectInfo: Pick<ProjectInfo, "srcDir">
): Promise<GeneratedFiles> {
  const dir = projectInfo.srcDir ? "src" : "";
  const configImport = projectInfo.srcDir
    ? "../nextly.config"
    : "./nextly.config";
  const result: GeneratedFiles = { written: [], changed: [], skipped: [] };
  const nextConfig = await readNextConfig(cwd);

  for (const name of HOOK_NAMES) {
    const relative = path.posix.join(dir, name);
    if (await fs.pathExists(path.join(cwd, relative))) {
      result.skipped.push({
        path: relative,
        why: "the app already has a server-start hook, so it was left as it is",
        toAdd: linesToAdd(configImport),
      });
      return result;
    }
  }

  const relative = path.posix.join(dir, "instrumentation.ts");
  if (nextConfig?.text.includes("pageExtensions")) {
    result.skipped.push({
      path: relative,
      why: `${nextConfig.name} sets pageExtensions, and Next.js reads the hook only under a name with one of them, so none was written; create it under that name with this content`,
      toAdd: instrumentationHook(configImport),
    });
    return result;
  }

  // Through writeNew, as every existing-app file is: created exclusively, and
  // never through a folder on its path that is a link.
  const hook = instrumentationHook(configImport);
  await writeNew(cwd, relative, hook, result, {
    why: "it is already there; Nextly's hook, which is",
    toAdd: hook,
  });
  return result;
}
