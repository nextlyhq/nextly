/**
 * Changing what an existing component lets its placements set.
 *
 * Saving a selection as a component nominates its exposed fields once
 * (`planSaveAsComponent`). These planners are what a designer does afterwards,
 * in the component's own view: expose another prop, rename a field, point it
 * at a different prop, remove it, or remove an exposed slot.
 *
 * Each is pure and returns the whole edited definition, so the dry run and the
 * write are the same object. The rules they hold:
 *
 * - **An id is never reused.** A removed field's id is RETIRED: placements may
 *   still hold values under it until those are stripped, so minting it again
 *   would revive them on a field they were never meant for. New ids are minted
 *   past every live and retired one. The retired list is kept by the caller,
 *   outside the envelope (see `retired-exposures`), and each edit reports the
 *   ids it retires.
 * - **A type change is a removal plus an addition.** A placement's value is
 *   typed by its exposure; keeping the id across a change of type would land
 *   every placement's text on, say, a rich-text prop. Pointing a field at
 *   another prop of the SAME type keeps the id and every value.
 * - **Removal prunes the variants in the same edit**, so no variant names a
 *   field the component no longer has. A variant left with nothing is kept,
 *   with a warning: it renders the component's defaults.
 * - **A lock is judged when the exposure is added.** Inside a `"contentOnly"`
 *   area only content can change, so exposing anything else there offers every
 *   placement a change the lock refuses.
 * - **The result passes the envelope check** the definition's own save runs,
 *   asked through `componentEnvelopeIssues` rather than restated.
 *
 * The exposure's type is inferred from the prop it drives, through
 * {@link exposureTypeForProp}, so a designer picks a prop rather than a type.
 *
 * @module exposure-planners
 */
import type { PropSchema } from "./block";
import { nodeLocks } from "./content-only-exposures";
import {
  isComponentDocument,
  type BlockDocument,
  type ComponentDocument,
  type ExposedProperty,
  type ExposedPropertyType,
} from "./document";
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import type { RetiredExposures } from "./retired-exposures";
import { RICH_TEXT_PROP_TYPE } from "./rich-text";
import { boundedOwnKeys } from "./safe-record";
import { contentPropsOf } from "./slot-lock";
import type { SlotDefaultSource } from "./tree";
import {
  componentEnvelopeIssues,
  isErrorIssue,
  type ValidationIssue,
} from "./validation";

/**
 * The prop path a `visibility` exposure stores.
 *
 * Visibility belongs to the node, not to one of its props, and the resolver
 * reads only the type of such an exposure. The envelope still requires a path
 * in the binding grammar, so it holds this one, which the inspector already
 * uses.
 */
export const VISIBILITY_PROP_PATH = "visibility";

/** What an exposure drives: one prop of a node, or the node's visibility. */
export type ExposureTarget =
  | {
      readonly nodeId: string;
      /** A prop the node's block declares, by name. */
      readonly propPath: string;
      readonly visibility?: undefined;
    }
  | {
      readonly nodeId: string;
      /** Let placements hide the node. */
      readonly visibility: true;
      readonly propPath?: undefined;
    };

/** A new exposure: what it drives, and what the inspector calls it. */
export type ExposeRequest = ExposureTarget & { readonly label: string };

/** What the planners read besides the definition itself. */
export interface ExposureSources {
  /**
   * The block definitions, for each prop's declared type and role and each
   * slot's lock.
   */
  readonly definitions: SlotDefaultSource;
  /** The ids this component has retired, never to be minted again. */
  readonly retired?: RetiredExposures;
}

/** Why an edit was refused. */
export type ExposureEditProblem =
  /** The document is not a component definition, or cannot be read as one. */
  | "not-a-component"
  /** No exposed field or slot has that id. */
  | "unknown-exposure"
  /** The target node is not in the component's tree. */
  | "unknown-node"
  /** The target node's block declares no such prop. */
  | "unknown-prop"
  /** No exposure type edits a prop of that type, or a select has no options. */
  | "not-exposable"
  /** The target is not content, and sits inside a `"contentOnly"` area. */
  | "content-only"
  /** The label is blank. */
  | "invalid-label"
  /** The edited envelope would fail the definition's own save. */
  | "invalid-exposure";

/** One variant a removal took a value from. */
export interface PrunedVariant {
  /** The variant's key, which placements store. */
  readonly variant: string;
  readonly label: string;
  /** True when that was its only value, so it now shows the defaults. */
  readonly emptied: boolean;
}

/** An edit the definition's save would accept. */
export interface ExposureEdit {
  /** The whole edited definition. The one passed in is never changed. */
  readonly document: ComponentDocument;
  /**
   * The field or slot the edit is about: the one added, renamed or kept, the
   * NEW id after a type change, or the one removed.
   */
  readonly id: string;
  /** The ids this edit retires, for the caller to add to the stored list. */
  readonly retired: RetiredExposures;
  /** Each variant that lost a value. */
  readonly prunedVariants: readonly PrunedVariant[];
  /** What the definition's save would warn about, such as an emptied variant. */
  readonly warnings: readonly ValidationIssue[];
}

/** A refused edit. */
export interface ExposureEditRefusal {
  readonly problem: ExposureEditProblem;
  /** The envelope errors, for `"invalid-exposure"`. */
  readonly issues?: readonly ValidationIssue[];
}

export type ExposureEditResult = ExposureEdit | ExposureEditRefusal;

/**
 * The exposure type that edits a prop of this schema, or `undefined` for none.
 *
 * By the prop's declared field type: a text field is edited as text, rich text
 * as rich text, a media reference as an image, a URL as a link, and a select
 * as a select. Anything else (a number, a checkbox, a list) has no exposure
 * control, so it is not offered.
 *
 * An image exposes the MEDIA prop, the value the image control writes as its
 * source of truth; the block resolves its address from that, so one exposure
 * drives one path.
 */
export function exposureTypeForProp(
  schema: PropSchema | undefined
): Exclude<ExposedPropertyType, "visibility"> | undefined {
  switch (schema?.type) {
    case "text":
    case "textarea":
    case "email":
      return "text";
    case RICH_TEXT_PROP_TYPE:
      return "richText";
    case "media":
      return "image";
    case "url":
      return "link";
    case "select":
      return "select";
    default:
      return undefined;
  }
}

/**
 * Expose a prop of a node, or the node's visibility, as a new field.
 *
 * The id is minted from the label, past every live and retired id, and kept
 * from then on whatever the field is later renamed to.
 */
export function planExposeProperty(
  definition: BlockDocument,
  request: ExposeRequest,
  sources: ExposureSources
): ExposureEditResult {
  const draft = editable(definition);
  if (draft === undefined) return { problem: "not-a-component" };
  const label = cleanLabel(request.label);
  if (label === undefined) return { problem: "invalid-label" };

  const pointed = pointAt(draft, request, sources.definitions);
  if ("problem" in pointed) return pointed;

  const exposed = draft.exposed ?? [];
  const id = mintId(label, takenIds(exposed, sources.retired));
  draft.exposed = [...exposed, { id, label, ...pointed }];
  return finished(draft, id, NOTHING_RETIRED, []);
}

/** Rename a field. The id, and so every placement's value, is unchanged. */
export function planRenameExposure(
  definition: BlockDocument,
  id: string,
  label: string
): ExposureEditResult {
  const draft = editable(definition);
  if (draft === undefined) return { problem: "not-a-component" };
  const clean = cleanLabel(label);
  if (clean === undefined) return { problem: "invalid-label" };
  const at = exposureIndex(draft, id);
  if (at === undefined) return { problem: "unknown-exposure" };

  const exposed = [...(draft.exposed ?? [])];
  exposed[at] = { ...exposed[at], label: clean };
  draft.exposed = exposed;
  return finished(draft, id, NOTHING_RETIRED, []);
}

/**
 * Point a field at another prop, or at a node's visibility.
 *
 * When the new target has the field's type, the id and every placement's
 * value are kept. When it has another type, the field is removed and a new
 * one added in its place, under the same label, with a new id: the old id is
 * retired and pruned from the variants, exactly as {@link planRemoveExposure}
 * does, and {@link ExposureEdit.retired} says so for the caller's dialog.
 */
export function planRetargetExposure(
  definition: BlockDocument,
  id: string,
  target: ExposureTarget,
  sources: ExposureSources
): ExposureEditResult {
  const draft = editable(definition);
  if (draft === undefined) return { problem: "not-a-component" };
  const at = exposureIndex(draft, id);
  if (at === undefined) return { problem: "unknown-exposure" };
  const pointed = pointAt(draft, target, sources.definitions);
  if ("problem" in pointed) return pointed;

  const exposed = [...(draft.exposed ?? [])];
  const current = exposed[at];
  if (current.type === pointed.type) {
    exposed[at] = { id, label: current.label, ...pointed };
    draft.exposed = exposed;
    return finished(draft, id, NOTHING_RETIRED, []);
  }

  const fresh = mintId(current.label, takenIds(exposed, sources.retired));
  exposed[at] = { id: fresh, label: current.label, ...pointed };
  draft.exposed = exposed;
  const pruned = pruneVariants(draft, id);
  return finished(draft, fresh, { properties: [id], slots: [] }, pruned);
}

/**
 * Remove a field, prune it from every variant, and retire its id.
 *
 * Placements keep their values until the caller strips them; the retired id
 * is what tells every later write to.
 */
export function planRemoveExposure(
  definition: BlockDocument,
  id: string
): ExposureEditResult {
  const draft = editable(definition);
  if (draft === undefined) return { problem: "not-a-component" };
  const at = exposureIndex(draft, id);
  if (at === undefined) return { problem: "unknown-exposure" };

  draft.exposed = (draft.exposed ?? []).filter((_, i) => i !== at);
  const pruned = pruneVariants(draft, id);
  return finished(draft, id, { properties: [id], slots: [] }, pruned);
}

/**
 * Remove an exposed slot and retire its id.
 *
 * The content placements gave it is no longer drawn anywhere, and goes when
 * the caller strips the retired id. Variants hold no slot content, so there is
 * nothing to prune.
 */
export function planRemoveExposedSlot(
  definition: BlockDocument,
  slotId: string
): ExposureEditResult {
  const draft = editable(definition);
  if (draft === undefined) return { problem: "not-a-component" };
  const slots = draft.slots;
  if (!isPlainRecord(slots) || !Object.hasOwn(slots, slotId)) {
    return { problem: "unknown-exposure" };
  }

  const kept = Object.fromEntries(
    Object.entries(slots).filter(([key]) => key !== slotId)
  );
  if (Object.keys(kept).length === 0) delete draft.slots;
  else draft.slots = kept;
  return finished(draft, slotId, { properties: [], slots: [slotId] }, []);
}

const NOTHING_RETIRED: RetiredExposures = { properties: [], slots: [] };

/**
 * A copy of the definition to edit, or `undefined` for one that is not a
 * component this module can read.
 *
 * Copied whole so no edit reaches the caller's document, a stored row or an
 * editor's state. A row that cannot be copied is not plain data, and nothing
 * stored by a save is anything else.
 */
function editable(definition: BlockDocument): ComponentDocument | undefined {
  if (!isPlainRecord(definition) || !isComponentDocument(definition)) {
    return undefined;
  }
  if (!Array.isArray(definition.nodes)) return undefined;
  try {
    return structuredClone(definition);
  } catch {
    return undefined;
  }
}

/** A label trimmed, or `undefined` when nothing is left. */
function cleanLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const trimmed = label.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Where a field with this id sits in the exposed list. */
function exposureIndex(
  definition: ComponentDocument,
  id: string
): number | undefined {
  const exposed = definition.exposed;
  if (!Array.isArray(exposed)) return undefined;
  const at = exposed.findIndex(
    entry => isPlainRecord(entry) && entry.id === id
  );
  return at === -1 ? undefined : at;
}

/** The pointer half of an exposure, everything but its id and label. */
type Pointer = Omit<ExposedProperty, "id" | "label">;

/**
 * Resolve a target into the pointer an exposure stores, judging it first.
 *
 * The node must be in the tree, and a prop must be one its block declares
 * (by name: an exposure drives a whole prop, as the inspector's rows do), of a
 * type some exposure edits. Inside a `"contentOnly"` area only a content prop
 * may be exposed, by the role its block declares, which is how every lock in
 * this engine is judged. Visibility is not content.
 */
function pointAt(
  definition: ComponentDocument,
  target: ExposureTarget,
  definitions: SlotDefaultSource
): Pointer | ExposureEditRefusal {
  const node = nodeLocks(definition.nodes, definitions).get(target.nodeId);
  if (node === undefined) return { problem: "unknown-node" };
  const locked = node.area !== undefined;

  if (target.visibility === true) {
    if (locked) return { problem: "content-only" };
    return {
      nodeId: target.nodeId,
      propPath: VISIBILITY_PROP_PATH,
      type: "visibility",
    };
  }
  return pointAtProp(target, definitions.get(node.type)?.props, locked);
}

/** The pointer for one declared prop of a node, judged against its lock. */
function pointAtProp(
  target: { readonly nodeId: string; readonly propPath: string },
  props: Partial<Record<string, PropSchema>> | undefined,
  locked: boolean
): Pointer | ExposureEditRefusal {
  const schema = declaredProp(props, target.propPath);
  if (schema === undefined) return { problem: "unknown-prop" };
  const type = exposureTypeForProp(schema);
  if (type === undefined) return { problem: "not-exposable" };
  if (locked && !contentPropsOf(props).has(target.propPath)) {
    return { problem: "content-only" };
  }

  const pointer = { nodeId: target.nodeId, propPath: target.propPath };
  if (type !== "select") return { ...pointer, type };
  const options = selectOptions(schema.options);
  if (options.length === 0) return { problem: "not-exposable" };
  return { ...pointer, type, options };
}

/** A prop's schema, when the block declares it as its own. */
function declaredProp(
  props: Partial<Record<string, PropSchema>> | undefined,
  name: string
): PropSchema | undefined {
  if (!isPlainRecord(props) || !Object.hasOwn(props, name)) return undefined;
  return props[name];
}

/**
 * A select prop's choices, in the shape an exposure stores.
 *
 * A block declares each as a bare string or as `{ value, label }`; a bare
 * string is its own label. Anything else is skipped, since an exposure offers
 * only choices the inspector can draw.
 */
function selectOptions(declared: unknown): { value: string; label: string }[] {
  if (!Array.isArray(declared)) return [];
  const options: { value: string; label: string }[] = [];
  for (const option of declared.slice(0, MAX_ENVELOPE_ENTRIES)) {
    if (typeof option === "string") {
      options.push({ value: option, label: option });
    } else if (
      isPlainRecord(option) &&
      typeof option.value === "string" &&
      typeof option.label === "string"
    ) {
      options.push({ value: option.value, label: option.label });
    }
  }
  return options;
}

/** Every id a new field may not take: the live ones and the retired ones. */
function takenIds(
  exposed: readonly unknown[],
  retired: RetiredExposures | undefined
): ReadonlySet<string> {
  const taken = new Set<string>(retired?.properties);
  for (const entry of exposed) {
    if (isPlainRecord(entry) && typeof entry.id === "string") {
      taken.add(entry.id);
    }
  }
  return taken;
}

/**
 * A new field id, readable and never taken.
 *
 * Derived from the label once, at minting, because API clients address a
 * placement's values by these ids and `title` reads better there than a
 * random string. It is never derived again: renaming the field keeps it. A
 * taken slug gets the first free numeric suffix.
 */
function mintId(label: string, taken: ReadonlySet<string>): string {
  const slug =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "field";
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const candidate = `${slug}-${String(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Take a field's value out of every variant, saying which lost one. */
function pruneVariants(
  definition: ComponentDocument,
  id: string
): PrunedVariant[] {
  const variants = definition.variants;
  if (!isPlainRecord(variants)) return [];
  const pruned: PrunedVariant[] = [];
  for (const key of boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES) ?? []) {
    const variant: unknown = variants[key];
    if (!isPlainRecord(variant) || !isPlainRecord(variant.overrides)) continue;
    const overrides = variant.overrides;
    if (!Object.hasOwn(overrides, id)) continue;
    delete overrides[id];
    pruned.push({
      variant: key,
      label: typeof variant.label === "string" ? variant.label : key,
      emptied: boundedOwnKeys(overrides, 0) !== null,
    });
  }
  return pruned;
}

/** The edit, or the envelope errors that would refuse its save. */
function finished(
  document: ComponentDocument,
  id: string,
  retired: RetiredExposures,
  prunedVariants: PrunedVariant[]
): ExposureEditResult {
  const issues = componentEnvelopeIssues(document);
  if (issues.some(isErrorIssue)) {
    return { problem: "invalid-exposure", issues: issues.filter(isErrorIssue) };
  }
  return { document, id, retired, prunedVariants, warnings: issues };
}
