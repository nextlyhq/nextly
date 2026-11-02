/**
 * What a write may store as a placement's own values.
 *
 * A placement keeps its values raw, keyed by the component's exposure ids. The
 * document's own validation can only say that the record is a record: whether
 * an id names a field and whether a value fits that field are facts about the
 * COMPONENT, which the document does not hold. So they are judged here, against
 * the definitions the write composes with.
 *
 * Only what the write SETS is judged. A value the stored document already held
 * at the same placement is kept as it is, however it reads now: a field
 * removed from the component leaves its values behind until they are cleaned
 * up, and refusing every unrelated save of the page for them would block an
 * author who did not cause it. A retired id is not this module's to keep or
 * refuse; the strip on write removes it.
 *
 * @module placement-values
 */
import {
  COMPONENT_INSTANCE_TYPE,
  isUnsetOverride,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
import { walkForest, isDescendable } from "./forest-walk";
import {
  DEFAULT_LIMITS,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "./limits";
import { isPlainRecord } from "./plain-record";
import { readableDefinition, type ComponentLookup } from "./resolve-instances";
import { isRichTextValue } from "./rich-text";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import { isLinkableUrl } from "./url-policy";

/** Why a placement's value was refused. */
export type PlacementValueProblem =
  | "unknown-field"
  | "wrong-type"
  /** More values than the envelope cap, which the resolver reads none of. */
  | "too-many-values";

/** One value a write sets that its placement's component does not accept. */
export interface PlacementValueIssue {
  /** The placement's node id. */
  readonly nodeId: string;
  readonly componentId: string;
  /** The exposure id the value is stored under; empty for `too-many-values`. */
  readonly exposureId: string;
  readonly problem: PlacementValueProblem;
  /** A sentence naming the field and what it needs. */
  readonly message: string;
}

/**
 * Every value `document` newly sets on a placement that its component does not
 * accept: an id the component does not expose, or a value of the wrong type for
 * the field.
 *
 * `stored` is every stored form of the same document (its draft and its
 * published value). A value equal to the one any of them holds under the same
 * placement and id is kept unjudged. A placement whose component the lookup
 * cannot read is not judged: the composition reports it as missing.
 *
 * Bounded by the host's node cap and the envelope cap, as every walk over a
 * stored document is.
 *
 * @experimental Settles when the placement inspector that uses it ships.
 */
export function placementValueIssues(
  document: BlockDocument,
  definitions: ComponentLookup,
  stored: readonly unknown[] = [],
  limits: DocumentLimits = DEFAULT_LIMITS
): readonly PlacementValueIssue[] {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) return [];
  const before = storedPlacements(stored, limits);
  const issues: PlacementValueIssue[] = [];
  forEachPlacement(document.nodes, limits.maxNodes, node => {
    const props = node.props;
    const componentId = props.componentId as string;
    const overrides = props.overrides;
    if (!isPlainRecord(overrides)) return;
    const definition = readableDefinition(definitions.get(componentId));
    if (definition === undefined) return;
    const kept = before.get(placementKey(node.id, componentId)) ?? [];
    const keys = boundedOwnKeys(overrides, MAX_ENVELOPE_ENTRIES);
    if (keys === null) {
      // Past the cap the resolver applies none of them, so they cannot be
      // judged one by one and would be stored unread. Kept only as the stored
      // document already held them.
      if (!kept.some(form => sameValue(form, overrides))) {
        issues.push({
          nodeId: node.id,
          componentId,
          exposureId: "",
          problem: "too-many-values",
          message: `A placement of component "${componentId}" stores more than ${String(MAX_ENVELOPE_ENTRIES)} values, more than a component can expose. Remove the values its component does not expose.`,
        });
      }
      return;
    }
    const exposures = exposuresById(definition);
    for (const key of keys) {
      const value = ownEntry(overrides, key);
      if (keptValue(kept, key, value)) continue;
      const property = exposures.get(key);
      if (property === undefined) {
        issues.push({
          nodeId: node.id,
          componentId,
          exposureId: key,
          problem: "unknown-field",
          message: `A placement of component "${componentId}" sets "${key}", which that component does not expose. Remove the value, or expose the field on the component first.`,
        });
        continue;
      }
      if (!exposedValueFits(property, value)) {
        issues.push({
          nodeId: node.id,
          componentId,
          exposureId: key,
          problem: "wrong-type",
          message: `${labelOf(property)} ${neededFor(property)}.`,
        });
      }
    }
  });
  return issues;
}

/**
 * Whether a value fits an exposed field: the type a placement's control writes
 * for it, or the `$unset` sentinel that clears any field.
 *
 * - text: a string;
 * - rich text: a rich-text document, or a string;
 * - image: a media id, as a non-empty string;
 * - link: an address the renderer would draw as a link;
 * - visibility: `true` or `false`;
 * - select: one of the field's choices, or any string when it declares none.
 *
 * @experimental Settles when the placement inspector that uses it ships.
 */
export function exposedValueFits(
  property: Pick<ExposedProperty, "type" | "options">,
  value: unknown
): boolean {
  if (isUnsetOverride(value)) return true;
  switch (property.type) {
    case "text":
      return typeof value === "string";
    case "richText":
      return typeof value === "string" || isRichTextValue(value);
    case "image":
      return typeof value === "string" && value !== "";
    case "link":
      return isLinkableUrl(value);
    case "visibility":
      return typeof value === "boolean";
    case "select": {
      if (typeof value !== "string") return false;
      const choices = choicesOf(property.options);
      return choices.length === 0 || choices.includes(value);
    }
    default:
      return true;
  }
}

/**
 * What a field needs, as the end of a sentence that starts with its label:
 * "Title needs text".
 *
 * @experimental Settles when the placement inspector that uses it ships.
 */
export function neededFor(
  property: Pick<ExposedProperty, "type" | "options">
): string {
  switch (property.type) {
    case "text":
      return "needs text";
    case "richText":
      return "needs rich text";
    case "image":
      return "needs an image";
    case "link":
      return "needs a link: a web address, a path, or a mailto: or tel: link";
    case "visibility":
      return "needs to be shown or hidden";
    case "select": {
      const choices = choicesOf(property.options);
      return choices.length === 0
        ? "needs one of its choices"
        : `needs one of: ${choices.join(", ")}`;
    }
    default:
      return "needs a different value";
  }
}

/**
 * Every placement the stored forms hold, keyed by node id AND component, with
 * each form's values.
 *
 * A placement that moved keeps its id, and so its values. The component is in
 * the key because the two forms may disagree about it: a draft that already
 * points a placement at another component keeps that component's values as
 * its own baseline, beside the published form's for the first.
 */
function storedPlacements(
  stored: readonly unknown[],
  limits: DocumentLimits
): Map<string, Record<string, unknown>[]> {
  const found = new Map<string, Record<string, unknown>[]>();
  for (const form of stored) {
    if (!isPlainRecord(form) || !Array.isArray(form.nodes)) continue;
    forEachPlacement(form.nodes, limits.maxNodes, node => {
      const props = node.props;
      const key = placementKey(node.id, props.componentId as string);
      const overrides = isPlainRecord(props.overrides) ? props.overrides : {};
      const values = found.get(key) ?? [];
      values.push(overrides);
      found.set(key, values);
    });
  }
  return found;
}

/** One placement of one component, as the stored baselines are keyed. */
function placementKey(nodeId: string, componentId: string): string {
  return `${nodeId}\u0000${componentId}`;
}

/** Whether any stored form holds this same value under this id. */
function keptValue(
  forms: readonly Record<string, unknown>[],
  key: string,
  value: unknown
): boolean {
  return forms.some(
    form =>
      Object.prototype.hasOwnProperty.call(form, key) &&
      sameValue(ownEntry(form, key), value)
  );
}

/**
 * Structural equality for stored JSON values. Records compare by their own
 * keys, so a value read back from storage with its keys in another order is
 * still the same value.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((entry, index) => sameValue(entry, b[index]));
  }
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    key =>
      Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key])
  );
}

/** Visit every well-formed placement in a forest, within the node cap. */
function forEachPlacement(
  nodes: readonly unknown[],
  maxNodes: number,
  visit: (node: BlockNode) => void
): void {
  let seen = 0;
  walkForest(nodes, ({ node, cycle }) => {
    seen += 1;
    if (seen > maxNodes) return "stop";
    if (cycle || !isDescendable(node)) return "skip";
    if (
      node.type === COMPONENT_INSTANCE_TYPE &&
      isPlainRecord(node.props) &&
      typeof node.props.componentId === "string"
    ) {
      visit(node);
    }
    return "descend";
  });
}

/**
 * The component's exposures by id. Two rows may share an id; the first is
 * the one judged, since both are written by the one value.
 */
function exposuresById(
  definition: ComponentDocument
): Map<string, ExposedProperty> {
  const byId = new Map<string, ExposedProperty>();
  const exposed: unknown = definition.exposed;
  if (!Array.isArray(exposed)) return byId;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (!isPlainRecord(entry)) continue;
    if (typeof entry.id !== "string" || typeof entry.type !== "string")
      continue;
    if (!byId.has(entry.id))
      byId.set(entry.id, entry as unknown as ExposedProperty);
  }
  return byId;
}

/** A select's choice values, read defensively from a stored definition. */
function choicesOf(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options.slice(0, MAX_ENVELOPE_ENTRIES) as unknown[]) {
    if (isPlainRecord(option) && typeof option.value === "string") {
      values.push(option.value);
    }
  }
  return values;
}

/** A field's label, or its id when the stored label is unusable. */
function labelOf(property: ExposedProperty): string {
  const label: unknown = property.label;
  return typeof label === "string" && label.trim() !== "" ? label : property.id;
}
