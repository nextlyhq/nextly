import path from "path";

import fs from "fs-extra";

import type { GeneratedFiles } from "./generated-files";
import { configStringList, findConfigFile } from "./next-config";

/**
 * The page extension to name a new module file with, a hook or a route: a
 * TypeScript one first, since Nextly's files are TypeScript, then a
 * JavaScript one; never a content extension such as `mdx`, which Next.js
 * would compile as content, and never `cjs`, since the files are ES modules
 * and a `.cjs` file cannot hold one. Null when the list holds no extension a
 * module can be written in.
 */
export function moduleExtension(extensions: readonly string[]): string | null {
  const usable = writable(extensions);
  return (
    usable.find(extension => /(^|\.)tsx?$/.test(extension)) ??
    usable.find(extension => /(^|\.)(js|jsx|mjs)$/.test(extension)) ??
    null
  );
}

/**
 * The extensions a file with code in it can be written under: not a
 * declaration file's (`d.ts`, `d.mts`, `d.cts`), which TypeScript reads as
 * types only and refuses code in.
 */
function writable(extensions: readonly string[]): readonly string[] {
  return extensions.filter(extension => !/(^|\.)d\.[cm]?tsx?$/.test(extension));
}

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

/**
 * The text of the app's Next.js config, or null when it has none, from the
 * file the Next config step reads and extends ({@link findConfigFile}).
 */
async function readNextConfig(
  cwd: string
): Promise<{ name: string; text: string } | null> {
  const name = await findConfigFile(cwd);
  return name === null
    ? null
    : { name, text: await fs.readFile(path.join(cwd, name), "utf-8") };
}

/**
 * The page extension for a file of TypeScript with JSX, such as a page or a
 * layout: one ending in `tsx`. Null when the list holds none.
 */
export function tsxExtension(extensions: readonly string[]): string | null {
  return (
    writable(extensions).find(extension => /(^|\.)tsx$/.test(extension)) ?? null
  );
}

/** What a file's content needs of its extension: how to pick one, and what to call it. */
export interface ExtensionNeed {
  pick: (extensions: readonly string[]) => string | null;
  holds: string;
}

/** A JavaScript or TypeScript module without JSX, such as a route. */
export const MODULE_FILE: ExtensionNeed = {
  pick: moduleExtension,
  holds: "a JavaScript or TypeScript extension",
};

/** TypeScript with JSX, such as a page or a layout. */
export const TSX_FILE: ExtensionNeed = {
  pick: tsxExtension,
  holds: "an extension ending in tsx",
};

/**
 * The report for a file an app that sets `pageExtensions` gets in place of
 * the file: the name to create it under and its content. Next.js routes a
 * file there only under a name with one of the app's extensions, and the app
 * may already have the file under such a name, which the existing-app steps
 * do not look for, so nothing is written. A list that cannot be read, or that
 * holds no extension the content needs, gives a placeholder name and says
 * which.
 *
 * @param base the file's path without its extension, as reported, such as
 *   `app/admin/[[...params]]/page`
 */
export function pageExtensionsSkip(
  base: string,
  text: string,
  pages: { configName: string; extensions: readonly string[] | null },
  need: ExtensionNeed
): GeneratedFiles["skipped"][number] {
  const { configName, extensions } = pages;
  const extension = extensions === null ? null : need.pick(extensions);
  const sets = `${configName} sets pageExtensions, and Next.js routes a file there only under a name with one of them, so none was written`;
  if (extensions !== null && extension === null) {
    return {
      path: `${base}.<${need.holds} added to pageExtensions>`,
      why: `${sets}, and none of them (${extensions.join(", ")}) is ${need.holds}; add one to pageExtensions, then, unless the app already has this file, create it under that name with this content`,
      toAdd: text,
    };
  }
  return {
    path: `${base}.${extension ?? "<one of your pageExtensions>"}`,
    why: `${sets}; unless the app already has this file, create it under that name with this content`,
    toAdd: text,
  };
}
