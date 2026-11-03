/**
 * The step that turns every copy of one component into the plain blocks it
 * draws, for the rewrite that runs before the component is deleted.
 *
 * Each stored form of each host is converted on its own with the engine's
 * `inlineComponentInstances`, the planner behind an author's own detach, so
 * the blocks that replace a copy are the ones the page drew for it. Anything
 * the engine refuses, and any value it cannot read to the end, is refused
 * here too: doubt never reads as "this host has no copy".
 *
 * @module host-rewrite/component-delete-step
 * @experimental
 */
import {
  componentReferencesIn,
  inlineComponentInstances,
  stillReferences,
  type DefinitionsById,
  type DocumentLimits,
  type InlineProblem,
  type NestingSource,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import { asDocument } from "../component-store-source";

import type { HostStep, StoredForm } from "./contract";

/** What the step reads its definitions and rules from. */
export interface ComponentDeleteStepArgs {
  /** The component being deleted. */
  readonly componentId: string;
  /**
   * The definitions of these components, as the form being converted draws
   * them. Every component the document places is asked for, not only the one
   * being deleted: a placement's override is read against its own definition.
   */
  readonly definitions: (
    componentIds: readonly string[],
    form: StoredForm
  ) => Promise<DefinitionsById>;
  /** The site's nesting rules. */
  readonly nesting: NestingSource;
  /** The block definitions, for the locks their slots declare. */
  readonly blocks: SlotDefaultSource;
  /** The caps the converted document must stay within. */
  readonly limits: DocumentLimits;
}

/**
 * The step: `unchanged` for a form with no copy, `rewritten` with every copy
 * converted, or `refuse` with the reason the engine gave.
 *
 * @experimental
 */
export function componentDeleteStep(args: ComponentDeleteStepArgs): HostStep {
  return async (doc, form) => {
    const document = asDocument(doc);
    if (document === null) {
      return refusal("unreadable");
    }
    const references = stillReferences(
      document,
      args.componentId,
      args.limits.maxNodes
    );
    if (references === "no") return { kind: "unchanged" };
    if (references === "unknown") return refusal("unreadable");

    const placed = componentReferencesIn(document, args.limits.maxNodes);
    const definitions = await args.definitions(placed.ids, form);
    const inlined = inlineComponentInstances(
      document,
      args.componentId,
      definitions,
      args.nesting,
      args.blocks,
      args.limits
    );
    if (inlined.problem !== undefined) return refusal(inlined.problem);
    // A value the engine had nothing to convert in: the reference is through
    // something the engine already judged, so nothing is written.
    if (inlined.converted === 0) return { kind: "unchanged" };
    // In the encoding it arrived in, so text stays text.
    return {
      kind: "rewritten",
      value:
        typeof doc === "string"
          ? JSON.stringify(inlined.document)
          : inlined.document,
    };
  };
}

/** A refusal, in words an author can act on. */
function refusal(problem: InlineProblem): { kind: "refuse"; reason: string } {
  return {
    kind: "refuse",
    reason: `${REASONS[problem] ?? GENERIC} (${problem})`,
  };
}

/** What to tell an author for each refusal the engine can give. */
const REASONS: Partial<Record<InlineProblem, string>> = {
  unreadable:
    "This content could not be read to the end, so its copies of the component cannot all be found.",
  "picked-by-override":
    "This content uses the component through a variant or an override rather than a copy. Change that by hand first.",
  "exposure-points-inside":
    "This component exposes a field or slot inside the copy, which turning it into plain blocks would remove.",
  "destination-locked":
    "Turning the copy into plain blocks would change a locked slot.",
  "exceeds-limits":
    "Turning the copy into plain blocks would make this content larger than the site allows.",
};

/** The words for a refusal without words of its own. */
const GENERIC =
  "The copy of the component cannot be turned into plain blocks here.";
