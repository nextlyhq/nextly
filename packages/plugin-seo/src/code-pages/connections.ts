/**
 * Which routes built in code call `seoMetadata`, recorded from the answer
 * their head is worked out with: when the site's page-metadata provider is
 * asked about a page built in code, the route serving it has called the
 * function, and what its code supplied is exactly what the provider was
 * given. Recorded there, the screen and the sitemap read the very values the
 * head was answered with.
 *
 * @module code-pages/connections
 */
import type {
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { textOf } from "../plain-values";

import { recordBuiltPage } from "./build-record";
import { isNextBuild } from "./building";
import { codePagesSlug } from "./collection";
import type { ReadCodeRoutes } from "./routes";
import {
  nameOfAddress,
  readCodePage,
  recordConnection,
  recorded,
  type CodePageRow,
  type Connection,
} from "./store";

/**
 * The started plugin's reader of the site's pages built in code, and where
 * its build is, on `globalThis` so every module the plugin is loaded in
 * reads the one the started plugin kept.
 */
const shared = globalThis as unknown as {
  __nextly_seoCodeRoutes?: KeptCodeRoutes;
};

/** What the started plugin keeps of the site's pages built in code. */
export interface KeptCodeRoutes {
  /** Every page built in code the running site has. */
  read: ReadCodeRoutes;
  /** The build directory, where `next build` writes its id. */
  buildDir: () => string;
}

/** Keep the started plugin's reader of the site's pages built in code. */
export function keepCodeRoutes(kept: KeptCodeRoutes): void {
  shared.__nextly_seoCodeRoutes = kept;
}

/**
 * Record, while `next build` renders the site, that the page built in code
 * at `path` is one this build has (`code-pages/build-record`), in the build
 * directory the started plugin was given; nothing outside the build, or
 * where no plugin has started.
 */
export async function recordBuiltCodePage(
  ctx: PluginContext,
  path: string
): Promise<void> {
  const kept = shared.__nextly_seoCodeRoutes;
  if (!isNextBuild() || kept === undefined) return;
  await recordBuiltPage(ctx, kept.buildDir(), path);
}

/**
 * Whether a call for `path` may be recorded: during the build, which renders
 * only the site's own addresses, or for an address the site already knows
 * of. A request for any other address must not make a row, or each made-up
 * address a visitor asks for would add one.
 */
async function mayRecord(
  ctx: PluginContext,
  path: string,
  row: CodePageRow | undefined
): Promise<boolean> {
  if (isNextBuild() || row !== undefined) return true;
  const kept = shared.__nextly_seoCodeRoutes;
  return (
    kept !== undefined &&
    (await kept.read(ctx)).some(route => route.path === path)
  );
}

/** The address and what the call says, for a page built in code. */
function callOf(
  ctx: PluginContext,
  input: PageMetadataInput
): { path: string; connection: Connection } | undefined {
  const { source } = input;
  if (source.kind !== "entry" || source.collection !== codePagesSlug(ctx)) {
    return undefined;
  }
  const path = textOf(source.entry.path);
  if (path === undefined) return undefined;
  // A name the route gave, which the page is otherwise named from its address.
  const title = textOf(source.entry.title);
  const named = title !== undefined && title !== nameOfAddress(path);
  // The date the route states, handed with the page (`codePageDocument`).
  const lastModified = textOf(source.entry.lastModified);
  return {
    path,
    connection: {
      ...(named ? { name: title } : {}),
      code: input.code,
      ...(lastModified === undefined ? {} : { lastModified }),
    },
  };
}

/** Record the call `input` stands for, where it says something new. */
async function record(
  ctx: PluginContext,
  input: PageMetadataInput
): Promise<void> {
  const call = callOf(ctx, input);
  if (call === undefined) return;
  try {
    const row = await readCodePage(ctx, call.path);
    if (recorded(row, call.connection)) return;
    if (!(await mayRecord(ctx, call.path, row))) return;
    await recordConnection(ctx, call.path, row, call.connection);
  } catch (error) {
    // The page's head is answered whatever happens to the record.
    ctx.logger.warn("A page built in code could not be recorded", {
      path: call.path,
      error,
    });
  }
}

/**
 * `resolver`, recording each page built in code it is asked about before it
 * answers.
 */
export function withCodePageConnections(
  ctx: PluginContext,
  resolver: PageMetadataResolver
): PageMetadataResolver {
  return {
    ...(resolver.tags === undefined
      ? {}
      : { tags: input => resolver.tags?.(input) ?? [] }),
    async resolve(input) {
      await record(ctx, input);
      return resolver.resolve(input);
    },
  };
}
