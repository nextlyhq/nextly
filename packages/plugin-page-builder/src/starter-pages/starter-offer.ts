/**
 * Which starter pages a site offers now, and the page body one gives a new
 * page.
 *
 * **Offered, or unavailable with why.** Every starter this boot registered is
 * listed. One the site can't hold now (a block, variable or shared style it
 * no longer has, or more than its page limits allow) carries the reason
 * (`starter-fit`) rather than being left out, so an author sees it is there
 * and why it can't be used; a page made from it is refused in the same words.
 *
 * **Copied once.** A starter's blocks reach a page through the engine's
 * paste planner, the same fresh-id copy a paste makes and without the record
 * of a saved section the copy did not come from, applied by the op layer to
 * an empty page. Every block gets a new id, nothing links the page back to
 * the starter, and the starter's own blocks are never handed out to be
 * changed.
 *
 * @module starter-pages/starter-offer
 */
import {
  applyOps,
  DOCUMENT_FORMAT_VERSION,
  OpError,
  planPasteBlocks,
  type BlockDocument,
  type BlockRegistryReader,
  type DocumentKind,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";

import type { NewPageStarter } from "../pages-write-contract";

import {
  starterDocument,
  starterFit,
  starterMisfitReason,
  type StarterMisfit,
  type StarterSite,
} from "./starter-fit";
import type { RegisteredStarterPage } from "./starter-pages";

/** A starter as the site offers it now: with why it can't be used, if it can't. */
export interface StarterOffer {
  readonly entry: RegisteredStarterPage;
  /** Absent when the site can use the starter now. */
  readonly misfit?: StarterMisfit;
}

/**
 * Every starter this boot registered, in order, each judged against what the
 * site has and allows now.
 */
export function starterOffers(
  registered: readonly RegisteredStarterPage[],
  site: StarterSite,
  limits?: DocumentLimits
): StarterOffer[] {
  return registered.map(entry => {
    const misfit = starterFit(entry.starter, site, limits);
    return misfit === undefined ? { entry } : { entry, misfit };
  });
}

/** A starter as the New page dialog and the empty page list it. */
export function starterItem(
  starter: StarterPageDefinition,
  misfit?: StarterMisfit
): NewPageStarter {
  return {
    id: starter.id,
    label: starter.label,
    description: starter.description,
    document: starterDocument(starter),
    ...(misfit === undefined
      ? {}
      : { unavailable: { reason: starterMisfitReason(misfit) } }),
  };
}

/** Whether a Page Builder field taking `kinds` holds a page, which a starter is. */
export function takesPages(
  kinds: readonly DocumentKind[] | undefined
): boolean {
  return kinds === undefined || kinds.includes("page");
}

/**
 * The page body `starter` gives a new page: its blocks copied with new ids
 * into an empty page, through the paste planner and the op layer, or
 * `undefined` where the plan or the apply refuses them now (the site's
 * rules moved since the boot judged them).
 */
export function starterPageCopy(
  starter: StarterPageDefinition,
  blocks: BlockRegistryReader,
  limits?: DocumentLimits
): BlockDocument | undefined {
  const empty: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [],
  };
  const plan = planPasteBlocks(
    empty,
    starter.blocks,
    { index: 0 },
    blocks.nestingSource()
  );
  if (plan.pageOps === undefined) return undefined;
  try {
    return applyOps(empty, plan.pageOps, limits).document;
  } catch (error) {
    // An apply the op layer refuses (a cap on the page's size) offers
    // nothing rather than a half-made page; anything else is no refusal.
    if (error instanceof OpError) return undefined;
    throw error;
  }
}
