/**
 * What the editor's unbind plan route takes and answers, named where both
 * ends can read it.
 *
 * The inspector unbinds a prop in the document it is editing, unsaved blocks
 * included, and keeps in the prop's place what the page actions API would:
 * the route plans it with the same decision (`planUnbind`), and the editor
 * applies the plan to its own document, saved with its next save as any edit
 * is.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives.
 *
 * @module unbind-plan-contract
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { KeptProps, UnbindKeep } from "@nextlyhq/builder/ops";

import type { UnbindAnswer } from "./composition-actions-contract";

/** Where the editor asks for an unbind's plan, under this plugin's namespace. */
export const UNBIND_PLAN_ROUTE_PATH = "/unbind-plan";

/** What the editor asks: which prop of which block, in the page being edited. */
export interface UnbindPlanRequest {
  /** The page being edited, by its collection and id, and its language. */
  readonly page: {
    readonly collection: string;
    readonly id: string;
    readonly locale?: string;
  };
  /** The document as the editor holds it now, unsaved blocks included. */
  readonly document: BlockDocument;
  /** The unbind, as the page actions API spells it. */
  readonly action: {
    readonly kind: "unbind-prop";
    readonly nodeId: string;
    readonly prop: string;
    readonly keep?: UnbindKeep;
  };
}

/** The props the editor writes in the binding's place and the answer, or why not. */
export type UnbindPlanResponse =
  | { readonly kept: KeptProps; readonly answer: UnbindAnswer }
  | { readonly refusal: string };
