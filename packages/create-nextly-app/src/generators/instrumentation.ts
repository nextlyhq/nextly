import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";

import type { GeneratedFiles } from "./generated-files";
import { nextConfigFileToChange, nextMajor } from "./next-config";

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

/** The key Next.js 14 needs before it runs an instrumentation hook. */
const OPT_IN = "experimental: { instrumentationHook: true }";

/**
 * What to tell an app about Next.js 14's opt-in, or null when it needs none.
 *
 * The major is the installed one, read the way the config patcher reads it,
 * so a range such as `latest` or `^14 || ^15` is not guessed at. When even
 * that cannot tell, the advice is given for the case it applies to. An app
 * with no config gets a whole one to create, since a key alone is not a file.
 */
function hookOptIn(
  major: number | null,
  nextConfig: { name: string } | null,
  configFile: string
): GeneratedFiles["skipped"][number] | null {
  if (major !== null && major !== 14) return null;
  const when =
    major === 14
      ? "Next.js 14 runs instrumentation.ts only when the config opts in"
      : "the installed Next.js version could not be read, and Next.js 14 runs instrumentation.ts only when the config opts in";
  if (!nextConfig) {
    // The same file the Next config step names for Nextly's packages, so
    // following both pieces of advice makes one config, not two.
    return {
      path: configFile,
      why: `${when}, and the app has no Next.js config; on Next.js 14, create this file, which is also where Nextly's packages go`,
      toAdd: `/** @type {import('next').NextConfig} */\nexport default {\n  ${OPT_IN},\n};\n`,
    };
  }
  return {
    path: nextConfig.name,
    why: `${when}, and the config was left as it is`,
    toAdd: `On Next.js 14, add instrumentationHook: true inside the config's experimental object, beside any keys it already has, or add the object when there is none:\n\n${OPT_IN},`,
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
 * itself is never edited: on Next.js 14, which runs the hook only with
 * \`experimental.instrumentationHook\`, the line to add is reported instead.
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

  const optIn = hookOptIn(
    await nextMajor(cwd),
    nextConfig,
    await nextConfigFileToChange(cwd)
  );
  if (optIn) result.skipped.push(optIn);

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

  await fs.ensureDir(path.dirname(path.join(cwd, relative)));
  await fs.writeFile(
    path.join(cwd, relative),
    instrumentationHook(configImport),
    {
      encoding: "utf-8",
      flag: "wx",
    }
  );
  result.written.push(relative);
  return result;
}
