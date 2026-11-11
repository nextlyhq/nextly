/**
 * The answer each page built in code is served, worked out as the page's
 * head works it out: by the one order of who wins, from what a person typed
 * for its address and what its route's code supplied when it last called.
 *
 * @module code-pages/answers
 */
import { addressOfRequest, type PluginContext } from "@nextlyhq/plugin-sdk";

import {
  addressHolders,
  withAddressHolders,
} from "../address-record/participant";
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

/**
 * Which of `paths`, on the site at `origin`, a document holds, in whichever
 * language each address is: a published entry, or a translation of one,
 * served there. Its SEO is then the entry's, hidden or not, never a page
 * built in code's. The record is read once per language for them all.
 */
export async function heldByDocuments(
  ctx: PluginContext,
  paths: readonly string[],
  origin: string
): Promise<Set<string>> {
  const byLanguage = new Map<string, { path: string; at: string }[]>();
  for (const path of paths) {
    const address = await addressOfRequest(new URL(path, origin));
    if (address === undefined) continue;
    const each = byLanguage.get(address.locale) ?? [];
    each.push({ path, at: address.path });
    byLanguage.set(address.locale, each);
  }
  const own = codePagesSlug(ctx);
  const held = new Set<string>();
  for (const [language, each] of byLanguage) {
    await withAddressHolders(
      ctx,
      language,
      each.map(({ at }) => at),
      async () => {
        for (const { path, at } of each) {
          const holders = await addressHolders(ctx, at, language);
          if (holders.some(holder => holder.collection !== own)) held.add(path);
        }
      }
    );
  }
  return held;
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
