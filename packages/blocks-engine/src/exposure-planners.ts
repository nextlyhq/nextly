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
import { optionLabel, type PropSchema } from "./block";
import { editableComponent, editVerdict } from "./component-edit";
import { nodeLocks } from "./content-only-exposures";
import type {
  BlockDocument,
  ComponentDocument,
  ExposedProperty,
} from "./document";
import {
  DEFAULT_LIMITS,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "./limits";
import { isPlainRecord } from "./plain-record";
import { exposureTypeForProp } from "./prop-exposure";
import type { RetiredExposures } from "./retired-exposures";
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
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export const VISIBILITY_PROP_PATH = "visibility";

/**
 * What an exposure drives: one prop of a node, or the node's visibility.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
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

/**
 * A new exposure: what it drives, and what the inspector calls it.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export type ExposeRequest = ExposureTarget & { readonly label: string };

/**
 * What the planners read besides the definition itself.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface ExposureSources {
  /**
   * The block definitions, for each prop's declared type and role and each
   * slot's lock.
   */
  readonly definitions: SlotDefaultSource;
  /** The ids this component has retired, never to be minted again. */
  readonly retired?: RetiredExposures;
  /**
   * The host's document limits, which its save judges the definition under.
   * Defaults to the engine's. A host that raised `maxNodes` passes its own, or
   * a target past the default cap would read as missing.
   */
  readonly limits?: DocumentLimits;
}

/**
 * Why an edit was refused.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
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
  | "invalid-exposure"
  /** The edited definition would be past the host's size, depth or node caps. */
  | "exceeds-limits";

/**
 * One variant a removal took a value from.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface PrunedVariant {
  /** The variant's key, which placements store. */
  readonly variant: string;
  readonly label: string;
  /** True when that was its only value, so it now shows the defaults. */
  readonly emptied: boolean;
}

/**
 * An edit the definition's save would accept.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
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

/**
 * A refused edit.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface ExposureEditRefusal {
  readonly problem: ExposureEditProblem;
  /** The envelope errors, for `"invalid-exposure"`. */
  readonly issues?: readonly ValidationIssue[];
}

/**
 * What every planner here answers: the edit, or why it was refused.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export type ExposureEditResult = ExposureEdit | ExposureEditRefusal;

// Declared in its own module, which imports nothing that validates, so the
// binding rules can derive their prop kinds from it without a cycle.
export { exposureTypeForProp };

/**
 * Expose a prop of a node, or the node's visibility, as a new field.
 *
 * The id is minted from the label, past every live and retired id, and kept
 * from then on whatever the field is later renamed to.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planExposeProperty(
  definition: BlockDocument,
  request: ExposeRequest,
  sources: ExposureSources
): ExposureEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const label = cleanLabel(request.label);
  if (label === undefined) return { problem: "invalid-label" };

  const limits = sources.limits ?? DEFAULT_LIMITS;
  const pointed = pointAt(draft, request, sources.definitions, limits);
  if ("problem" in pointed) return pointed;

  const exposed = draft.exposed ?? [];
  const id = mintId(label, takenIds(exposed, sources.retired));
  draft.exposed = [...exposed, { id, label, ...pointed }];
  return finished(draft, id, NOTHING_RETIRED, [], limits);
}

/**
 * Rename a field. The id, and so every placement's value, is unchanged.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planRenameExposure(
  definition: BlockDocument,
  id: string,
  label: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): ExposureEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const clean = cleanLabel(label);
  if (clean === undefined) return { problem: "invalid-label" };
  const at = exposureIndex(draft, id);
  if (at === undefined) return { problem: "unknown-exposure" };

  const exposed = [...(draft.exposed ?? [])];
  exposed[at] = { ...exposed[at], label: clean };
  draft.exposed = exposed;
  return finished(draft, id, NOTHING_RETIRED, [], limits);
}

/**
 * Point a field at another prop, or at a node's visibility.
 *
 * When the new target has the field's type, the id and every placement's
 * value are kept. When it has another type, the field is removed and a new
 * one added in its place, under the same label, with a new id: the old id is
 * retired and pruned from the variants, exactly as {@link planRemoveExposure}
 * does, and {@link ExposureEdit.retired} says so for the caller's dialog.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planRetargetExposure(
  definition: BlockDocument,
  id: string,
  target: ExposureTarget,
  sources: ExposureSources
): ExposureEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const at = exposureIndex(draft, id);
  if (at === undefined) return { problem: "unknown-exposure" };
  const limits = sources.limits ?? DEFAULT_LIMITS;
  const exposed = [...(draft.exposed ?? [])];
  const current = exposed[at];
  // Re-pointing reads the stored label and choices, so they are asked first:
  // an imported row may hold anything there, and reading a malformed one
  // throws where this promises a refusal. Renaming and removing read neither,
  // and stay open as the way to repair such an entry.
  if (!isUsableExposure(current)) {
    return {
      problem: "invalid-exposure",
      issues: componentEnvelopeIssues(draft, limits).filter(isErrorIssue),
    };
  }
  const pointed = pointAt(draft, target, sources.definitions, limits);
  if ("problem" in pointed) return pointed;

  if (keepsValues(current, pointed)) {
    exposed[at] = { id, label: current.label, ...pointed };
    draft.exposed = exposed;
    return finished(draft, id, NOTHING_RETIRED, [], limits);
  }

  const fresh = mintId(current.label, takenIds(exposed, sources.retired));
  exposed[at] = { id: fresh, label: current.label, ...pointed };
  draft.exposed = exposed;
  return retiring(draft, fresh, id, limits);
}

/**
 * Remove a field, prune it from every variant, and retire its id.
 *
 * Placements keep their values until the caller strips them; the retired id
 * is what tells every later write to.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planRemoveExposure(
  definition: BlockDocument,
  id: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): ExposureEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const at = exposureIndex(draft, id);
  if (at === undefined) return { problem: "unknown-exposure" };

  draft.exposed = (draft.exposed ?? []).filter((_, i) => i !== at);
  return retiring(draft, id, id, limits);
}

/**
 * Remove an exposed slot and retire its id.
 *
 * The content placements gave it is no longer drawn anywhere, and goes when
 * the caller strips the retired id. Variants hold no slot content, so there is
 * nothing to prune.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planRemoveExposedSlot(
  definition: BlockDocument,
  slotId: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): ExposureEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const slots = draft.slots;
  if (!isPlainRecord(slots) || !Object.hasOwn(slots, slotId)) {
    return { problem: "unknown-exposure" };
  }

  const kept = Object.fromEntries(
    Object.entries(slots).filter(([key]) => key !== slotId)
  );
  if (Object.keys(kept).length === 0) delete draft.slots;
  else draft.slots = kept;
  const retired = { properties: [], slots: [slotId] };
  return finished(draft, slotId, retired, [], limits);
}

const NOTHING_RETIRED: RetiredExposures = { properties: [], slots: [] };

/** A copy of the definition to edit, or why it cannot be edited. */
function editable(
  definition: BlockDocument
): ComponentDocument | ExposureEditRefusal {
  const draft = editableComponent(definition);
  if (draft === "not-a-component") return { problem: "not-a-component" };
  if ("issues" in draft) {
    return { problem: "invalid-exposure", issues: draft.issues };
  }
  return draft;
}

/**
 * Whether a stored exposure has the label and choices re-pointing reads: a
 * non-empty label, and for a select a list of `{ value, label }` strings.
 */
function isUsableExposure(entry: unknown): entry is ExposedProperty {
  if (!isPlainRecord(entry)) return false;
  if (typeof entry.label !== "string" || entry.label === "") return false;
  if (entry.type !== "select") return true;
  return (
    Array.isArray(entry.options) &&
    entry.options.every(
      option =>
        isPlainRecord(option) &&
        typeof option.value === "string" &&
        typeof option.label === "string"
    )
  );
}

/**
 * Whether every value a placement may hold for `current` is one `next` still
 * takes, so re-pointing can keep the id and the values.
 *
 * The same type, and for a select every old choice still offered: a value is
 * stored as the choice itself, and override validation does not hold it to the
 * options, so a choice the new prop lacks would reach the block as written.
 */
function keepsValues(current: ExposedProperty, next: Pointer): boolean {
  if (current.type !== next.type) return false;
  if (current.type !== "select") return true;
  const offered = new Set((next.options ?? []).map(option => option.value));
  return (current.options ?? []).every(option => offered.has(option.value));
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
  definitions: SlotDefaultSource,
  limits: DocumentLimits
): Pointer | ExposureEditRefusal {
  const node = nodeLocks(definition.nodes, definitions, limits.maxNodes).get(
    target.nodeId
  );
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
  const options = selectOptions(schema);
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
 * string is labelled as the block's inspector labels it, by its
 * `optionLabels` entry or as itself, so a placement offers the same words.
 * Anything else is skipped, since an exposure offers only choices the
 * inspector can draw.
 */
function selectOptions(schema: PropSchema): { value: string; label: string }[] {
  const declared = schema.options;
  if (!Array.isArray(declared)) return [];
  const options: { value: string; label: string }[] = [];
  for (const option of declared.slice(0, MAX_ENVELOPE_ENTRIES)) {
    if (typeof option === "string") {
      options.push({ value: option, label: optionLabel(schema, option) });
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

/**
 * Finish an edit that took the field `gone` off a row: retire it and prune it
 * from the variants, unless another row still drives it.
 *
 * Stored or imported data can hold one id on two rows, which the envelope check
 * refuses only while both remain. Retiring an id a remaining row still drives
 * would strip every placement's value for that live field, so it is kept, with
 * its variant values.
 */
function retiring(
  draft: ComponentDocument,
  id: string,
  gone: string,
  limits: DocumentLimits
): ExposureEditResult {
  const stillUsed = (draft.exposed ?? []).some(
    entry => isPlainRecord(entry) && entry.id === gone
  );
  if (stillUsed) return finished(draft, id, NOTHING_RETIRED, [], limits);
  const pruned = pruneVariants(draft, gone);
  const retired = { properties: [gone], slots: [] };
  return finished(draft, id, retired, pruned, limits);
}

/** The edit, or the envelope errors that would refuse its save. */
function finished(
  document: ComponentDocument,
  id: string,
  retired: RetiredExposures,
  prunedVariants: PrunedVariant[],
  limits: DocumentLimits
): ExposureEditResult {
  // An exposure or a longer label only ever makes the definition bigger, so
  // whether it still fits is asked as the save asks it.
  const judged = editVerdict(document, limits);
  if (judged.verdict === "exceeds-limits") return { problem: "exceeds-limits" };
  if (judged.verdict === "refused") {
    return { problem: "invalid-exposure", issues: judged.errors };
  }
  return { document, id, retired, prunedVariants, warnings: judged.warnings };
}
