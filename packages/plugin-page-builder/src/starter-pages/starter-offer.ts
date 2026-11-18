/**
 * Which starter pages a site offers now, and the page body one gives a new
 * page.
 *
 * **Offered.** A starter whose blocks or variables the site no longer has
 * is left out of the list rather than offered half-drawn: a variable an
 * author removed in Design, or a block a plugin that was turned off
 * supplied. What a starter needs is read by the walk an export carries a
 * page's references by (`collectDocumentReferences`), so the two agree on
 * what a document names.
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
  collectDocumentReferences,
  emptyReferences,
  registryMediaProps,
} from "../transfer/transfer-references";

import type { RegisteredStarterPage } from "./starter-pages";

/** What the site has now, which a starter's needs are judged against. */
export interface StarterSite {
  /** The site's block registry. */
  readonly blocks: BlockRegistryReader;
  /** The identities of every variable the site defines now. */
  readonly variables: ReadonlySet<string>;
}

/** A starter's blocks as a page document, the shape a page stores them in. */
function starterDocument(starter: StarterPageDefinition): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [...starter.blocks],
  };
}

/** Whether the site still has every block and variable `starter` names. */
function siteHasWhatStarterNeeds(
  starter: StarterPageDefinition,
  site: StarterSite
): boolean {
  const needs = emptyReferences();
  collectDocumentReferences(starterDocument(starter), needs, {
    mediaProps: type => registryMediaProps(site.blocks, type),
  });
  return (
    [...needs.blockTypes].every(type => site.blocks.has(type)) &&
    [...needs.tokens].every(token => site.variables.has(token))
  );
}

/** The starters a site offers now, in the order they were registered. */
export function offeredStarterPages(
  registered: readonly RegisteredStarterPage[],
  site: StarterSite
): RegisteredStarterPage[] {
  return registered.filter(entry =>
    siteHasWhatStarterNeeds(entry.starter, site)
  );
}

/** A starter as the New page dialog and the empty page list it. */
export function starterItem(starter: StarterPageDefinition): NewPageStarter {
  return {
    id: starter.id,
    label: starter.label,
    description: starter.description,
    document: starterDocument(starter),
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
