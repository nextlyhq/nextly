/**
 * What a write may store as a placement's variant.
 *
 * A placement stores the key of the variant it chose. Whether that key names a
 * variant is a fact about the COMPONENT, which the document does not hold, so
 * it is judged here against the definitions the write composes with.
 *
 * Only a key the write SETS is judged. A placement whose variant was deleted
 * keeps the key: it renders the component's defaults, the inspector says the
 * variant was removed, and a restored version that still holds the variant
 * brings it back. Refusing every later save of the page for it would block an
 * author who did not cause it, so a key any stored form already held at the
 * same placement is kept.
 *
 * @module placement-variants
 */
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import { isPlainRecord } from "./plain-record";
import {
  componentPlacementsIn,
  readableDefinition,
  type ComponentLookup,
} from "./resolve-instances";
import { ownEntry } from "./safe-record";

/**
 * A variant a write newly sets on a placement that its component does not
 * define.
 *
 * @experimental Settles when the placement inspector that uses it ships.
 */
export interface PlacementVariantIssue {
  /** The placement's node id. */
  readonly nodeId: string;
  readonly componentId: string;
  /** The key the placement stores. */
  readonly variantId: string;
  /** A sentence naming the key and what to do. */
  readonly message: string;
}

/**
 * Every placement in `document` whose variant key its component does not
 * define, unless a stored form of the same document already held that key at
 * that placement.
 *
 * `stored` is every stored form of the document (its draft and its published
 * value). A placement whose component the lookup cannot read is not judged:
 * the composition reports it as missing.
 *
 * @experimental Settles when the placement inspector that uses it ships.
 */
export function placementVariantIssues(
  document: unknown,
  definitions: ComponentLookup,
  stored: readonly unknown[] = [],
  limits: DocumentLimits = DEFAULT_LIMITS
): readonly PlacementVariantIssue[] {
  const issues: PlacementVariantIssue[] = [];
  let kept: ReadonlySet<string> | undefined;
  for (const { target, node } of componentPlacementsIn(
    document,
    limits.maxNodes
  ).placements) {
    const chosen = chosenVariant(node);
    if (chosen === undefined) continue;
    const definition = readableDefinition(definitions.get(target));
    if (definition === undefined) continue;
    const variants: unknown = definition.variants;
    if (isPlainRecord(variants) && ownEntry(variants, chosen.variant)) continue;
    // Read only once something is found, as most writes find nothing.
    kept ??= storedChoices(stored, limits);
    if (kept.has(choiceKey(chosen.nodeId, target, chosen.variant))) continue;
    issues.push({
      nodeId: chosen.nodeId,
      componentId: target,
      variantId: chosen.variant,
      message: `A placement of component "${target}" chooses the variant "${chosen.variant}", which that component does not define. Choose one of its variants, or none.`,
    });
  }
  return issues;
}

/** The node id and variant key a placement stores, when it chose one. */
function chosenVariant(
  node: unknown
): { nodeId: string; variant: string } | undefined {
  if (!isPlainRecord(node) || typeof node.id !== "string") return undefined;
  const props = node.props;
  if (!isPlainRecord(props)) return undefined;
  const variant = props.variant;
  return typeof variant === "string" && variant !== ""
    ? { nodeId: node.id, variant }
    : undefined;
}

/** Every placement, component and variant key the stored forms hold. */
function storedChoices(
  stored: readonly unknown[],
  limits: DocumentLimits
): ReadonlySet<string> {
  const found = new Set<string>();
  for (const form of stored) {
    for (const { target, node } of componentPlacementsIn(form, limits.maxNodes)
      .placements) {
      const chosen = chosenVariant(node);
      if (chosen !== undefined) {
        found.add(choiceKey(chosen.nodeId, target, chosen.variant));
      }
    }
  }
  return found;
}

/** One placement's choice, as the stored baselines are keyed. */
function choiceKey(nodeId: string, componentId: string, variant: string) {
  return `${nodeId}\u0000${componentId}\u0000${variant}`;
}
