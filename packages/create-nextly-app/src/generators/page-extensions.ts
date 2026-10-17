import path from "path";

import fs from "fs-extra";

import { configStringList } from "./next-config";

/**
 * The page extension to name a new module file with, a hook or a route: a
 * TypeScript one first, since Nextly's files are TypeScript, then a
 * JavaScript one; never a content extension such as `mdx`, which Next.js
 * would compile as content, and never `cjs`, since the files are ES modules
 * and a `.cjs` file cannot hold one. Null when the list holds no extension a
 * module can be written in.
 */
export function moduleExtension(extensions: readonly string[]): string | null {
  return (
    extensions.find(extension => /(^|\.)tsx?$/.test(extension)) ??
    extensions.find(extension => /(^|\.)(js|jsx|mjs)$/.test(extension)) ??
    null
  );
}

/** The files Next.js reads its own config from, in the order it looks. */
const NEXT_CONFIG_NAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
  "next.config.cjs",
];

/**
 * The `pageExtensions` the app's Next.js config sets, as every existing-app
 * step that names a file Next.js routes reads it: the list; `"absent"` when
 * the config sets none, or there is no config; or null when it is set in a
 * way that cannot be read. Read from the config the app exports, as the Next
 * config step reads it, so a commented-out or nested `pageExtensions` sets
 * nothing. `configName` is the file it was read from, for the report.
 */
export async function appPageExtensions(cwd: string): Promise<{
  configName: string;
  extensions: readonly string[] | null | "absent";
}> {
  const nextConfig = await readNextConfig(cwd);
  return {
    configName: nextConfig?.name ?? "The Next.js config",
    extensions: nextConfig
      ? configStringList(nextConfig.text, nextConfig.name, "pageExtensions")
      : "absent",
  };
}

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
