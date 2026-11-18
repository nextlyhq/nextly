/**
 * What the content, data and publishing checks know of a page beyond its
 * document, as the caller hands it in: the editor from what it already
 * reads and counts, a script or an agent from the same routes. Each fact is
 * optional, and a check of one left out finds nothing, so a caller that
 * knows less still gets every other check's findings.
 *
 * @module page-checks/page-facts
 * @experimental Grows with the checks that read it.
 */
import type { PageReadReport } from "../shell/read-budget";

/** One of the page's bindings that no longer fits, in the report's words. */
export interface BindingToFix {
  /** The bound block. */
  readonly nodeId: string;
  /** The bound setting, by its prop. */
  readonly prop: string;
  /** Where the binding is, as the report names it. */
  readonly where: string;
  /** What changed, and what visitors see until it is fixed, as a sentence. */
  readonly change: string;
}

/** The page's count of data against its limit, or why there is none yet. */
export type PageDataFact =
  | { readonly state: "counting" }
  | { readonly state: "failed" }
  | { readonly state: "counted"; readonly report: PageReadReport };

/** A part the page uses that isn't published. */
export interface UnpublishedPart {
  /** A component placed on the page, or the page's header & footer set. */
  readonly kind: "component" | "layout";
  readonly id: string;
  readonly title: string | null;
  /** Whether the person editing may publish it. */
  readonly mayPublish: boolean;
}

/** A header or footer the page shows twice: its set's, and one of its own. */
export interface DoubledRegionFact {
  readonly area: "header" | "footer";
  /** The page's own header (or footer) blocks, in page order. */
  readonly nodeIds: readonly string[];
  /** What the editor's notice says about it, in its words. */
  readonly said: string;
}

/** The facts, each where the caller knows it. */
export interface PageFacts {
  readonly bindingsToFix?: readonly BindingToFix[];
  readonly pageData?: PageDataFact;
  readonly unpublished?: readonly UnpublishedPart[];
  readonly doubledRegions?: readonly DoubledRegionFact[];
}
