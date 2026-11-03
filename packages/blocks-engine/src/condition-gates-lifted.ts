/**
 * A document, or a component library, with every condition gate lifted.
 *
 * The resolver leaves a placement a condition gates standing unexpanded, and
 * every placement inside a gated block with it, since no reader is served
 * them. But their values are stored, and served once the condition lifts, so
 * a lock a component holds still holds on them. Every check that asks what a
 * component's lock holds composes with the gates lifted, through these two,
 * so the editor refusing an edit and the save refusing a write are asked of
 * the same composition.
 *
 * @module condition-gates-lifted
 */
import type { BlockDocument } from "./document";
import type { DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import type { ComponentLookup } from "./resolve-instances";
import { walkNodes } from "./tree";
import { isConditionGated } from "./visibility";

/**
 * The document with every gate a condition puts on its own blocks lifted, or
 * `undefined` when it holds none, so a caller can tell nothing was lifted and
 * keep what it already composed.
 *
 * @experimental
 */
export function withConditionGatesLifted(
  document: BlockDocument,
  limits: Pick<DocumentLimits, "maxNodes">
): BlockDocument | undefined {
  const bound = { maxNodes: limits.maxNodes };
  // Asked of the document first: most documents gate no block, and then
  // nothing is cloned.
  let gated = false;
  walkNodes(
    document.nodes,
    node => {
      if (isConditionGated(node)) gated = true;
    },
    bound
  );
  if (!gated) return undefined;
  const copy = structuredClone(document);
  walkNodes(
    copy.nodes,
    node => {
      if (isConditionGated(node)) {
        delete (node as { visibility?: unknown }).visibility;
      }
    },
    bound
  );
  return copy;
}

/**
 * The definition with its gates lifted, or the definition itself when it gates
 * nothing or is not a document at all, which the resolver judges as it is.
 *
 * @experimental
 */
export function definitionWithConditionGatesLifted<T>(
  definition: T,
  limits: Pick<DocumentLimits, "maxNodes">
): T {
  if (!isPlainRecord(definition) || !Array.isArray(definition.nodes)) {
    return definition;
  }
  const lifted = withConditionGatesLifted(
    definition as unknown as BlockDocument,
    limits
  );
  return lifted === undefined ? definition : (lifted as unknown as T);
}

/**
 * A component library with every condition gate lifted, which can also say
 * whether lifting changed a definition.
 *
 * @experimental
 */
export interface UngatedComponentLookup extends ComponentLookup {
  /**
   * Whether the definition under this id gates a block, which this lookup
   * hands out lifted. Asked of a definition once, and remembered with it.
   */
  lifts(id: string): boolean;
}

/**
 * The library with every gate lifted in the definitions it supplies, each
 * lifted once, when it is first asked for. A definition gating nothing is
 * handed out as the library holds it.
 *
 * @experimental
 */
export function componentsWithConditionGatesLifted(
  components: ComponentLookup,
  limits: Pick<DocumentLimits, "maxNodes">
): UngatedComponentLookup {
  const read = new Map<
    string,
    { definition: BlockDocument | undefined; lifted: boolean }
  >();
  const entry = (id: string) => {
    let found = read.get(id);
    if (found === undefined) {
      const definition = components.get(id);
      const ungated =
        definition === undefined
          ? undefined
          : definitionWithConditionGatesLifted(definition, limits);
      found = { definition: ungated, lifted: ungated !== definition };
      read.set(id, found);
    }
    return found;
  };
  return {
    has: id => components.has(id),
    get: id => entry(id).definition,
    lifts: id => entry(id).lifted,
  };
}
