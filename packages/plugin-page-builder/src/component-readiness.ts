/**
 * Which component definitions a stored document embeds.
 *
 * The read half of the publish-readiness notice: a page can be published while
 * a component it embeds is not, and the live page then draws a missing-component
 * marker where the author expected content. Nothing told them, because the two
 * documents have separate lifecycles and publishing one says nothing about the
 * other.
 *
 * ## It answers what is REFERENCED, not what would render
 *
 * A condition-gated instance is counted. Gating is evaluated per request
 * against a context this write has no access to, so "would it render" is not a
 * question a hook can answer — and an instance gated off for today's visitor
 * still renders for tomorrow's. Counting references over-reports in exactly one
 * direction, and it is the safe one: the notice names a real component the
 * document really points at.
 *
 * ## Pure, and it does not decide what "published" means
 *
 * The caller supplies which ids came back from a published-scoped read. That is
 * deliberate: which lifecycle states count as public is the workflow's question
 * and the query service already answers it, so asking the store and treating
 * ABSENCE as the answer keeps one implementation of a rule that would otherwise
 * be spelled a second time here — and drift silently the moment a workflow
 * declares another public state.
 *
 * @module component-readiness
 */
import {
  COMPONENT_INSTANCE_TYPE,
  walkNodes,
  type BlockNode,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

/** The prop a component instance stores its definition's id under. */
const COMPONENT_ID_PROP = "componentId";

/**
 * Every component definition this forest references, deduplicated.
 *
 * Bounded by the same `maxNodes` the renderer reads under, because an unbounded
 * walk here would traverse a document the renderer refuses — the notice would
 * then name components no reader of this page can ever see.
 *
 * A blank id is dropped rather than reported. A stored `"   "` is a nonempty
 * string, so it survives as a reference while naming nothing; counted, it would
 * put a component in the notice that the author cannot go and find.
 */
export function embeddedComponentIds(
  nodes: readonly BlockNode[],
  limits: DocumentLimits
): string[] {
  const found = new Set<string>();
  walkNodes(
    [...nodes] as BlockNode[],
    node => {
      if (node.type !== COMPONENT_INSTANCE_TYPE) return;
      const id = (node.props as Record<string, unknown> | undefined)?.[
        COMPONENT_ID_PROP
      ];
      if (typeof id !== "string") return;
      const trimmed = id.trim();
      if (trimmed.length > 0) found.add(trimmed);
    },
    { maxNodes: limits.maxNodes }
  );
  return [...found];
}
