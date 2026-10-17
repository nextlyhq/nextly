import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

import type { GeneratedFiles } from "./generated-files";
import { appPageExtensions, moduleExtension } from "./page-extensions";
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

/**
 * The hook as `instrumentationHook` writes it, with its return type kept only
 * for a hook to be saved under a TypeScript extension. Its one piece of
 * TypeScript is that annotation; without it the hook is valid JavaScript and
 * valid TypeScript alike, which is what a JavaScript extension, or one this
 * could not read, needs.
 */
function hookFor(configImport: string, extension: string | null): string {
  const hook = instrumentationHook(configImport);
  return extension !== null && /(^|\.)tsx?$/.test(extension)
    ? hook
    : hook.replace("register(): Promise<void>", "register()");
}

/** The first of `names` the app already has beside `app/`, or null. */
async function existingHook(
  cwd: string,
  dir: string,
  names: readonly string[]
): Promise<string | null> {
  for (const name of names) {
    const relative = path.posix.join(dir, name);
    if (await fs.pathExists(path.join(cwd, relative))) return relative;
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
 * What to tell an app that sets `pageExtensions`, for which no hook is
 * written: the name to create it under, and its content.
 *
 * A list this cannot read is named as such rather than guessed, with a hook
 * valid under any JavaScript or TypeScript extension. A list it can read but
 * that holds no extension the hook can be written in gets no name at all,
 * since every name it could give is one Next.js would not load as a module:
 * the developer is told to add an extension first.
 */
function pageExtensionsAdvice(
  dir: string,
  configImport: string,
  configName: string,
  extensions: readonly string[] | null
): GeneratedFiles["skipped"][number] {
  const sets = `${configName} sets pageExtensions, and Next.js reads the hook only under a name with one of them, so none was written`;
  const extension = extensions === null ? null : moduleExtension(extensions);
  if (extensions !== null && extension === null) {
    return {
      path: path.posix.join(
        dir,
        "instrumentation.<a JavaScript or TypeScript extension added to pageExtensions>"
      ),
      why: `${sets}, and none of them (${extensions.join(", ")}) can hold the hook, which is a JavaScript or TypeScript module; add a JavaScript or TypeScript extension to pageExtensions, then create the hook under it with this content`,
      toAdd: hookFor(configImport, null),
    };
  }
  return {
    path: path.posix.join(
      dir,
      `instrumentation.${extension ?? "<one of your pageExtensions>"}`
    ),
    why: `${sets}; create it under that name with this content`,
    toAdd: hookFor(configImport, extension),
  };
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
  const { configName, extensions } = await appPageExtensions(cwd);

  // With pageExtensions set, Next.js reads the hook only as
  // `instrumentation.<extension>` for one of them, so a default-named file
  // beside it is one Next.js never loads. A hook under a configured name
  // belongs to the app: Nextly's start is added to it, never offered as a file
  // to write beside or over it. A list this cannot read leaves the defaults as
  // the only names it knows.
  const names =
    extensions === "absent" || extensions === null
      ? HOOK_NAMES
      : extensions.map(extension => `instrumentation.${extension}`);
  const existing = await existingHook(cwd, dir, names);
  if (existing) {
    result.skipped.push({
      path: existing,
      why: "the app already has a server-start hook, so it was left as it is",
      toAdd: linesToAdd(configImport),
    });
    return result;
  }

  const relative = path.posix.join(dir, "instrumentation.ts");
  if (extensions !== "absent") {
    result.skipped.push(
      pageExtensionsAdvice(dir, configImport, configName, extensions)
    );
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
