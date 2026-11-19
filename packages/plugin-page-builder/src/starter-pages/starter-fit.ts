/**
 * Whether this site can hold a starter page, and if not, why, in the words
 * both pickers, the create and the log use.
 *
 * A starter's fit is a question about USING it, not about starting the
 * server: a site may have turned a block off, removed a variable, or set page
 * limits tighter than a starter needs. So it is judged where starters are
 * listed and applied, against what the site has and allows now, and a starter
 * that doesn't fit is listed as unavailable with its reason rather than left
 * out, so an author never wonders where it went.
 *
 * One judgement and one wording: the picker's reason, the create's refusal
 * and the boot's log line all come from here, so they cannot disagree.
 *
 * @module starter-pages/starter-fit
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  surveyDocument,
  type BlockDocument,
  type BlockRegistryReader,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";

import {
  collectDocumentReferences,
  emptyReferences,
  registryMediaProps,
} from "../transfer/transfer-references";

import { starterUnavailableSentence } from "./starter-pages-contract";

/**
 * The smallest page limits every built-in starter fits within. A site whose
 * limits are at least these offers all of them; below, the ones that don't fit
 * are shown as unavailable. Held by a test against every built-in starter, and
 * never above {@link DEFAULT_LIMITS}, so a starter that grows past it fails
 * the build rather than disappearing from a site.
 */
export const BUILT_IN_STARTER_FLOOR: DocumentLimits = Object.freeze({
  maxDepth: 6,
  maxNodes: 100,
  maxBytes: 64 * 1024,
});

/** What the site has now, which a starter's needs are judged against. */
export interface StarterSite {
  /** The site's block registry. */
  readonly blocks: BlockRegistryReader;
  /**
   * The identities of every variable the site defines now; absent where they
   * can't be read yet (at start-up), when variables aren't judged.
   */
  readonly variables?: ReadonlySet<string>;
  /** The ids of every shared style the site defines now, or absent, as above. */
  readonly sharedStyles?: ReadonlySet<string>;
}

/** Why a site can't hold a starter: the first thing it lacks or exceeds. */
export type StarterMisfit =
  | { readonly kind: "block"; readonly type: string }
  | { readonly kind: "variable" }
  | { readonly kind: "shared style" }
  | {
      readonly kind: "depth" | "blocks" | "size";
      readonly needed: number;
      readonly allowed: number;
    };

/** A starter's blocks as a page document, the shape a page stores them in. */
export function starterDocument(starter: StarterPageDefinition): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [...starter.blocks],
  };
}

/**
 * The first block, variable or shared style `starter` names that `site`
 * doesn't have, read by the walk an export carries a page's references by, so
 * the two agree on what a document names.
 */
function missingNeed(
  starter: StarterPageDefinition,
  site: StarterSite
): StarterMisfit | undefined {
  const needs = emptyReferences();
  collectDocumentReferences(starterDocument(starter), needs, {
    mediaProps: type => registryMediaProps(site.blocks, type),
  });
  const block = [...needs.blockTypes].find(type => !site.blocks.has(type));
  if (block !== undefined) return { kind: "block", type: block };
  const { variables, sharedStyles } = site;
  if (variables && [...needs.tokens].some(token => !variables.has(token))) {
    return { kind: "variable" };
  }
  if (
    sharedStyles &&
    [...needs.classes].some(style => !sharedStyles.has(style))
  ) {
    return { kind: "shared style" };
  }
  return undefined;
}

/**
 * The first page limit `starter` exceeds, measured exactly: the survey runs
 * unbounded, since its counts are only lower bounds past a bound, and the
 * reason says how much the starter needs.
 */
function exceededLimit(
  starter: StarterPageDefinition,
  limits: DocumentLimits
): StarterMisfit | undefined {
  const survey = surveyDocument(starterDocument(starter), {
    maxDepth: Number.POSITIVE_INFINITY,
    maxNodes: Number.POSITIVE_INFINITY,
    maxBytes: Number.POSITIVE_INFINITY,
  });
  if (survey.depth > limits.maxDepth) {
    return { kind: "depth", needed: survey.depth, allowed: limits.maxDepth };
  }
  if (survey.nodes > limits.maxNodes) {
    return { kind: "blocks", needed: survey.nodes, allowed: limits.maxNodes };
  }
  if (survey.bytes > limits.maxBytes) {
    return { kind: "size", needed: survey.bytes, allowed: limits.maxBytes };
  }
  return undefined;
}

/**
 * Why `site` can't hold `starter` under `limits`, or `undefined` when it can:
 * what it lacks first, then what it exceeds.
 */
export function starterFit(
  starter: StarterPageDefinition,
  site: StarterSite,
  limits: DocumentLimits = DEFAULT_LIMITS
): StarterMisfit | undefined {
  return missingNeed(starter, site) ?? exceededLimit(starter, limits);
}

/** A block type as an author names it: `core/form` is "Form". */
function blockName(type: string): string {
  const name = type.slice(type.lastIndexOf("/") + 1).replace(/[-_]+/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A size in the unit an author reads it in. */
function sizeWords(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 1024
    ? `${String(Math.ceil(kb))} KB`
    : `${String(Math.round((kb / 1024) * 10) / 10)} MB`;
}

/** Why a starter isn't available, as the pickers show it under its name. */
export function starterMisfitReason(misfit: StarterMisfit): string {
  switch (misfit.kind) {
    case "block":
      return `Uses the ${blockName(misfit.type)} block, which this site doesn't have.`;
    case "variable":
      return "Uses a variable this site doesn't have.";
    case "shared style":
      return "Uses a shared style this site doesn't have.";
    case "depth":
      return `Needs ${String(misfit.needed)} levels of nesting; this site allows ${String(misfit.allowed)}.`;
    case "blocks":
      return `Has ${String(misfit.needed)} blocks; this site allows ${String(misfit.allowed)}.`;
    case "size":
      return `Is ${sizeWords(misfit.needed)}; this site allows ${sizeWords(misfit.allowed)}.`;
  }
}

/**
 * The refusal when a page is made from a starter the site can't hold: the
 * contract's one sentence, with the misfit's reason.
 */
export function starterMisfitSentence(
  starter: Pick<StarterPageDefinition, "label">,
  misfit: StarterMisfit
): string {
  return starterUnavailableSentence(starter.label, starterMisfitReason(misfit));
}
