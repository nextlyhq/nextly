/**
 * A component's Layers locks, held against what its variants set.
 *
 * A variant is a preset of override values a component offers its placements.
 * An override reaches a node through an exposure, so a variant whose value
 * lands on a block the component locks changes that block wherever the
 * variant is chosen, though the component's own nodes are untouched. The
 * comparison of nodes alone (`layersLockChanges`) cannot see it.
 *
 * So each variant of the WRITTEN component is drawn the way a placement
 * choosing it is drawn, through the resolver, with the same library a full
 * composition reads, and compared with the same component drawn choosing no
 * variant: the locks are the written component's, so a lock this very write
 * adds holds, and a block it unlocks may change. A variant the stored
 * component already drew the same way, over a block it already locked, is
 * kept, as any value a stored page already holds is.
 *
 * @module layers-lock-variants
 */
import { componentLayersLocks } from "./component-layers-locks";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  isComponentDocument,
  type BlockDocument,
} from "./document";
import { layersLockChanges, type LayersLockChange } from "./layers-lock-stored";
import type { DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import {
  resolveComponentInstances,
  variantNamesIn,
  type ComponentLookup,
} from "./resolve-instances";

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

/** What a variant is drawn with: the caps, and the library nested components come from. */
export interface VariantDrawing {
  readonly limits?: DocumentLimits;
  /**
   * The component library a full composition reads, for a component the
   * drawn one places. Absent, nested placements draw as placeholders.
   */
  readonly components?: ComponentLookup;
}

/** One component drawn as a placement choosing `variant` draws it. */
function drawn(
  component: BlockDocument,
  variant: string,
  { limits, components }: VariantDrawing
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
      has: id => id === SELF || components?.has(id) === true,
      get: id => (id === SELF ? component : components?.get(id)),
    },
    limits === undefined ? {} : { limits }
  ).document;
}

/**
 * Whether the stored component already drew this block this way under this
 * variant, over a lock it already held.
 */
function keptByStored(
  change: LayersLockChange,
  written: BlockDocument,
  stored: BlockDocument | undefined
): boolean {
  if (stored === undefined) return false;
  const locked = componentLayersLocks(stored.nodes);
  return (
    locked.get(change.id)?.holderId === change.id &&
    !layersLockChanges(written, stored).some(held => held.id === change.id)
  );
}

/**
 * Every block the written component locks that one of its variants changes,
 * outermost first, once per block. Empty when the written value is not a
 * component, or no variant changes a locked block.
 *
 * @param written - the component as the write would store it
 * @param stored - the component it replaces, or `undefined` for a create
 */
export function variantLockChanges(
  written: unknown,
  stored: unknown,
  drawing: VariantDrawing = {}
): VariantLockChange[] {
  if (!isComponent(written)) return [];
  const previous = isComponent(stored) ? stored : undefined;
  const unselected = drawn(written, "", drawing);
  const found: VariantLockChange[] = [];
  const reported = new Set<string>();
  for (const variant of variantNamesIn(written) ?? []) {
    const choosing = drawn(written, variant, drawing);
    const before =
      previous === undefined ? undefined : drawn(previous, variant, drawing);
    for (const change of layersLockChanges(choosing, unselected)) {
      if (reported.has(change.id)) continue;
      if (keptByStored(change, choosing, before)) continue;
      reported.add(change.id);
      found.push({ ...change, variant });
    }
  }
  return found;
}
