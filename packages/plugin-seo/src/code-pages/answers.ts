/**
 * The answer each page built in code is served, worked out as the page's
 * head works it out: by the one order of who wins, from what a person typed
 * for its address and what its route's code supplied when it last called.
 *
 * @module code-pages/answers
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import type { SeoAnswer } from "../resolver/order";
import { resolveSeo, type ReadRules } from "../resolver/provider";

import { codePagesSlug } from "./collection";
import type { CodeRoute } from "./routes";
import { codePageDocument, readCodePages, type CodePageRow } from "./store";

/** A page built in code, with its route, its row and its answer. */
export interface CodePage {
  route: CodeRoute;
  row: CodePageRow | undefined;
  answer: SeoAnswer;
}

/** The answer of the page built in code at `path`, from `row`. */
export function resolveCodePage(
  ctx: PluginContext,
  path: string,
  row: CodePageRow | undefined,
  readRules: ReadRules | undefined
): Promise<SeoAnswer> {
  return resolveSeo(
    ctx,
    {
      path,
      source: {
        kind: "entry",
        collection: codePagesSlug(ctx),
        entry: codePageDocument(path, row, undefined),
      },
      // What the route's code supplied when it last called, at its level.
      code: row?.code ?? {},
      derived: {},
    },
    readRules
  );
}

/**
 * Each page built in code that `routes` names and no entry is served at,
 * with the answer its head is built from.
 */
export async function codePages(
  ctx: PluginContext,
  routes: readonly CodeRoute[],
  readRules: ReadRules | undefined,
  entryPaths: ReadonlySet<string> = new Set()
): Promise<CodePage[]> {
  const rows = await readCodePages(ctx);
  const pages: CodePage[] = [];
  for (const route of routes) {
    if (entryPaths.has(route.path)) continue;
    const row = rows.get(route.path);
    pages.push({
      route,
      row,
      answer: await resolveCodePage(ctx, route.path, row, readRules),
    });
  }
  return pages;
}
