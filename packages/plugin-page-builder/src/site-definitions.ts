/**
 * What the site defines that a page refers to by id, from one stored record
 * of the Site Style Single: the one reading both judgements of a write make,
 * the blocks field's validation (the record read through the Direct API) and
 * the judgement under the composition graph lock (the record read on the
 * write's own transaction, `composition-rejudge`). Handed the record rather
 * than reading it, so where it was read is the caller's and what it means is
 * decided here once.
 *
 * @module site-definitions
 */
import {
  breakpointContexts,
  resolveSiteTokens,
  tokenIdentity,
} from "@nextlyhq/blocks-engine";
import type {
  PluginCollectionTransaction,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { UNLOCKED_READ } from "./composition-graph-lock";
import type { SiteDefinitions } from "./fields/blocks-composition";
import { siteBreakpoints, type SiteStyleData } from "./site-style";
import { referableClassIds } from "./site-style-record";
import { siteStyleOfDocument } from "./site-style-storage";

/**
 * The Site Style Single `slug` as stored, read on a write's own transaction
 * by the plugin's own read of a Single it declared: on the transaction's
 * connection, so a write holding the pool's last connection never waits for
 * a second one. A plain read (`UNLOCKED_READ`), as a page write reads it
 * under the composition graph lock, where a row lock would wait for a
 * removal holding the Single's row while that removal waits for the graph
 * lock (`composition-rejudge` says what the read sees, per dialect). A
 * removal reads its own Single with it too, whose row its UPDATE holds.
 */
export function siteStyleDocumentOn(
  reads: Pick<
    PluginContext["services"]["ownCollections"],
    "getSingleInTransaction"
  >,
  slug: string
): (transaction: PluginCollectionTransaction) => Promise<unknown> {
  return transaction =>
    reads.getSingleInTransaction(transaction, slug, UNLOCKED_READ);
}

/**
 * The classes, breakpoints and variables a page may name, from the Single's
 * stored document `doc` over the code's defaults.
 */
export async function siteDefinitionsOfDocument(
  doc: unknown,
  defaults: SiteStyleData | undefined
): Promise<SiteDefinitions> {
  const style = siteStyleOfDocument(doc, defaults);
  // Imported at call time: it imports `node:async_hooks`, which a browser
  // bundle reaching the package root cannot resolve.
  const { withProvisionalTokenIds } = await import(
    "./transfer/provisional-variables"
  );
  return {
    // Capped and resolved as the compiler reads the library, so a page may
    // reference exactly the classes it applies.
    classIds: referableClassIds(style.classes ?? []),
    // The ones its stylesheet is emitted under.
    breakpointIds: new Set(
      breakpointContexts(siteBreakpoints(style)).map(context => context.id)
    ),
    // Every tier of variables, as the stylesheet resolves them, so a page may
    // name exactly the variables it renders with. An import's judging writes
    // also count the variables it adds, which the site style holds only once
    // the import applies; no other write sees any.
    tokenIds: withProvisionalTokenIds(
      new Set(resolveSiteTokens(style.tokens).tokens.map(tokenIdentity))
    ),
  };
}
