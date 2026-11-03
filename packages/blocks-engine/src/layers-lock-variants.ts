/**
 * A component's Layers locks, held against what its variants set.
 *
 * A variant is a preset of override values a component offers its placements.
 * An override reaches a node through an exposure, so a variant whose value
 * lands on a block the component locks changes that block wherever the
 * variant is chosen, though the component's own nodes are untouched. The
 * comparison of nodes alone (`layersLockChanges`) cannot see it.
 *
 * So each variant is drawn the way a placement choosing it is drawn, through
 * the resolver, from the written component and from the stored one, and the
 * two drawings are compared with the same rule. The lock is the written
 * component's: a write that unlocks the block may also change what a variant
 * sets on it.
 *
 * @module layers-lock-variants
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  isComponentDocument,
  type BlockDocument,
} from "./document";
import { layersLockChanges, type LayersLockChange } from "./layers-lock-stored";
import type { DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import { resolveComponentInstances, variantNamesIn } from "./resolve-instances";

/** A broken lock, and the variant whose values break it. */
export interface VariantLockChange extends LayersLockChange {
  readonly variant: string;
}

/** The id the drawn component goes by, in the one-placement page. */
const SELF = "self";

/** Whether a value is a component document, read as one only once it is a record. */
function isComponent(value: unknown): value is BlockDocument {
  return (
    isPlainRecord(value) &&
    Array.isArray(value.nodes) &&
    isComponentDocument(value as unknown as BlockDocument)
  );
}

/** One component drawn as a placement choosing `variant` draws it. */
function drawn(
  component: BlockDocument,
  variant: string,
  limits: DocumentLimits | undefined
): BlockDocument {
  const host: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "variant",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: SELF, variant },
      },
    ],
  };
  return resolveComponentInstances(
    host,
    {
      has: id => id === SELF,
      get: id => (id === SELF ? component : undefined),
    },
    limits === undefined ? {} : { limits }
  ).document;
}

/**
 * Every block the written component locks that one of its variants changes
 * from what the stored component's same variant draws, outermost first, once
 * per block. Empty when either value is not a component, or no variant
 * changes a locked block.
 *
 * A variant the stored component lacks is measured against the component
 * drawn with no variant, which is what a placement choosing a name the
 * component does not offer draws.
 */
export function variantLockChanges(
  written: unknown,
  stored: unknown,
  limits?: DocumentLimits
): VariantLockChange[] {
  if (!isComponent(written) || !isComponent(stored)) return [];
  const names = new Set([
    ...(variantNamesIn(written) ?? []),
    ...(variantNamesIn(stored) ?? []),
  ]);
  const found: VariantLockChange[] = [];
  const reported = new Set<string>();
  for (const variant of names) {
    const changes = layersLockChanges(
      drawn(written, variant, limits),
      drawn(stored, variant, limits)
    );
    for (const change of changes) {
      if (reported.has(change.id)) continue;
      reported.add(change.id);
      found.push({ ...change, variant });
    }
  }
  return found;
}
