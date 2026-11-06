/**
 * What a designer does to a component's fields in its own view: expose a prop,
 * let placements hide a block, rename a field, remove one.
 *
 * Decides and draws nothing: which exposure a prop row holds, whether it can be
 * offered, the op an edit becomes and the sentences an author reads all live
 * here, where they can be asserted without a DOM. `component-fields-panel`
 * draws them.
 *
 * Every edit is asked of the engine's exposure planners, which hold the rules
 * (an id is never reused, a removal prunes the variants, a lock is judged when
 * the field is added), and written as ONE `envelope` op, so an exposure is one
 * undo step like any other edit and reaches autosave and recovery with the rest
 * of the document.
 *
 * @module component-fields
 */
import {
  EXPOSED_PROPERTY_TYPES,
  exposureTypeForProp,
  findNode,
  getBlock,
  isComponentDocument,
  isPlainRecord,
  planExposeProperty,
  planRemoveExposedSlot,
  planRemoveExposure,
  planRenameExposure,
  sameStoredValue,
  type BlockDocument,
  type ComponentDocument,
  type EnvelopeField,
  type ExposedProperty,
  type ExposedPropertyType,
  type ExposureEdit,
  type ExposureEditProblem,
  type ExposureEditResult,
  type PropSchema,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { blockLabel } from "./inserter";
import { fieldLabel, propLabel } from "./inspector";
import type { BuilderOp } from "./op-vocabulary";

/**
 * What the host knows about the component being edited that its document does
 * not hold.
 *
 * @experimental Settles when the component editor ships.
 */
export interface ComponentFieldsHost {
  /**
   * Field and slot ids this component must never mint again: those its
   * PUBLISHED definition holds, and every one it has retired. A draft that
   * dropped a published field still has placements holding values under its
   * id, so a new field minted under that id would take them over.
   *
   * `unavailable` while the host has not read them, or could not: adding a
   * field then waits, with that sentence, rather than minting an id the live
   * definition may still hold. Absent where the host has nothing live to
   * reserve.
   */
  readonly reserved?: RetiredExposures | ReservedUnavailable;
  /**
   * How many documents place this component DIRECTLY (pages, Singles, other
   * components and patterns), for the removal dialog: `complete` false makes
   * the number a floor, said as "at least". Pages reaching it through another
   * component are not counted, so it is never said as a count of pages.
   */
  readonly reach?: { readonly count: number; readonly complete: boolean };
  /**
   * How many distinct pages and Singles a change to the component reaches:
   * placed on them directly, inside another component, or in a Layout that
   * wraps them. What the banner over the view says; `complete` false makes
   * it a floor, said as "at least". Absent while the host has no count.
   */
  readonly pages?: { readonly count: number; readonly complete: boolean };
  /** The component's name, for the card heading its own view. */
  readonly name?: string;
}

/** Why the ids a new field must avoid are not known, said to the author. */
export interface ReservedUnavailable {
  readonly unavailable: string;
}

/** What an exposure is called in a sentence. The engine's names are code. */
export const EXPOSURE_TYPE_LABEL: Readonly<
  Record<ExposedPropertyType, string>
> = {
  text: "Text",
  richText: "Rich text",
  image: "Image",
  link: "Link",
  visibility: "Visibility",
  select: "Choice",
};

/** The component a document is, or `undefined` for a page or a pattern. */
export function editedComponent(
  document: BlockDocument
): ComponentDocument | undefined {
  return isComponentDocument(document) ? document : undefined;
}

/**
 * The fields a component exposes, read as a list whatever is stored.
 *
 * An entry that is not a field (a stored or imported row holding `null`, or
 * one without an id or a type) is left out rather than read: the view has to
 * open on such a component so the author can repair it, and the envelope
 * check names the broken entry on save.
 */
export function exposedFields(
  component: ComponentDocument
): readonly ExposedProperty[] {
  if (!Array.isArray(component.exposed)) return [];
  return component.exposed.filter(isReadableField);
}

function isReadableField(entry: unknown): entry is ExposedProperty {
  if (
    !isPlainRecord(entry) ||
    typeof entry.id !== "string" ||
    typeof entry.label !== "string" ||
    typeof entry.nodeId !== "string" ||
    !(EXPOSED_PROPERTY_TYPES as readonly unknown[]).includes(entry.type)
  ) {
    return false;
  }
  // Every field but visibility drives a prop, named by its path.
  return entry.type === "visibility" || typeof entry.propPath === "string";
}

/** The ids of the slots a component exposes. */
export function exposedSlotIds(
  component: ComponentDocument
): readonly string[] {
  const slots: unknown = component.slots;
  return slots !== null && typeof slots === "object" && !Array.isArray(slots)
    ? Object.keys(slots)
    : [];
}

/** The field exposing one prop of a node, if one does. */
export function propExposure(
  component: ComponentDocument,
  nodeId: string,
  propPath: string
): ExposedProperty | undefined {
  return exposedFields(component).find(
    field =>
      field.type !== "visibility" &&
      field.nodeId === nodeId &&
      field.propPath === propPath
  );
}

/** The field letting placements hide a node, if one does. */
export function visibilityExposure(
  component: ComponentDocument,
  nodeId: string
): ExposedProperty | undefined {
  return exposedFields(component).find(
    field => field.type === "visibility" && field.nodeId === nodeId
  );
}

/**
 * Whether a prop can be exposed, by its declared type: the field type it would
 * be, or the sentence saying why not. Shown rather than hidden, so an author
 * learns the prop is not exposable rather than wondering where the switch went.
 */
export function exposeOffer(
  schema: PropSchema
):
  | { readonly type: Exclude<ExposedPropertyType, "visibility"> }
  | { readonly reason: string } {
  const type = exposureTypeForProp(schema);
  if (type !== undefined) return { type };
  return {
    reason: `Pages can’t set a ${String(schema.type)} value, so this stays the same everywhere it is used.`,
  };
}

/** Why the engine refused an edit, as an author reads it. */
const PROBLEM_SENTENCE: Readonly<Record<ExposureEditProblem, string>> = {
  "not-a-component": "Fields can only be added in a component’s own view.",
  "unknown-exposure": "That field is no longer on this component.",
  "unknown-node": "That block is no longer in this component.",
  "unknown-prop": "That block no longer has this property.",
  "not-exposable":
    "Pages have no control for this property, so it stays the same everywhere it is used.",
  "content-only":
    "This block is in an area locked to its content, and this property isn’t content, so pages couldn’t change it. Loosen the lock to let each page change it.",
  "invalid-label": "Give the field a name.",
  "invalid-exposure":
    "This component’s fields are stored in a shape that can’t be edited here. Remove the broken field first.",
  "exceeds-limits": "This change would make the component too large to save.",
};

/** The sentence for a refusal. */
function problemSentence(problem: ExposureEditProblem): string {
  return PROBLEM_SENTENCE[problem];
}

/**
 * The one op that turns `before`'s envelope into `after`'s, or `undefined`
 * when the two hold the same fields, slots and variants.
 */
export function envelopeOpFor(
  before: ComponentDocument,
  after: ComponentDocument
): BuilderOp | undefined {
  const patch: Record<string, unknown> = {};
  const unset: EnvelopeField[] = [];
  for (const field of ["exposed", "slots", "variants"] as const) {
    const next = Object.hasOwn(after, field) ? after[field] : undefined;
    const now = Object.hasOwn(before, field) ? before[field] : undefined;
    if (sameStoredValue(now, next)) continue;
    if (next === undefined) unset.push(field);
    else patch[field] = next;
  }
  if (Object.keys(patch).length === 0 && unset.length === 0) return undefined;
  return {
    kind: "envelope",
    patch,
    ...(unset.length > 0 ? { unset } : {}),
  };
}

/**
 * Every id this component may not mint: what the host reserved, and every id
 * the editing session has seen, so a field removed and then added again under
 * the same name gets a new id rather than the removed one's values.
 */
export function reservedIds(
  host: RetiredExposures | ReservedUnavailable | undefined,
  seen: RetiredExposures
): RetiredExposures | ReservedUnavailable {
  if (host !== undefined && "unavailable" in host) return host;
  return {
    properties: [...new Set([...(host?.properties ?? []), ...seen.properties])],
    slots: [...new Set([...(host?.slots ?? []), ...seen.slots])],
  };
}

/** The ids a component holds now, to add to what a session has seen. */
export function idsIn(component: ComponentDocument): RetiredExposures {
  return {
    properties: exposedFields(component)
      .map(field => field.id)
      .filter((id): id is string => typeof id === "string"),
    slots: exposedSlotIds(component),
  };
}

/** What an edit came to: applied, or refused with the sentence to show. */
export type FieldEditOutcome =
  | { readonly applied: true; readonly edit: ExposureEdit }
  | { readonly applied: false; readonly reason: string };

/**
 * Apply a planned edit to the editor as one op, or say why it was not.
 *
 * The planner's result is applied as it stands: it is the whole edited
 * definition, judged by the same envelope check the save asks.
 */
export function applyFieldEdit(
  editor: Pick<EditorState, "apply">,
  component: ComponentDocument,
  result: ExposureEditResult
): FieldEditOutcome {
  if ("problem" in result) {
    return { applied: false, reason: problemSentence(result.problem) };
  }
  const op = envelopeOpFor(component, result.document);
  if (op === undefined) return { applied: true, edit: result };
  return editor.apply(op) === null
    ? {
        applied: false,
        reason: "This change could not be applied here. Nothing was changed.",
      }
    : { applied: true, edit: result };
}

/** What the planners read from the editor and the host, gathered once. */
export interface FieldEditContext {
  readonly editor: Pick<EditorState, "apply" | "lockDefinitions" | "limits">;
  readonly component: ComponentDocument;
  /** The ids a new field must avoid, or why they are not known yet. */
  readonly reserved: RetiredExposures | ReservedUnavailable;
}

/**
 * The ids an addition must avoid, or the refusal to give while they are not
 * known: minting without them could take a live field's id.
 */
function additionRetired(
  reserved: FieldEditContext["reserved"]
): RetiredExposures | { readonly applied: false; readonly reason: string } {
  return "unavailable" in reserved
    ? { applied: false, reason: reserved.unavailable }
    : reserved;
}

/** Expose one prop of a node as a new field under `label`. */
export function exposeProp(
  context: FieldEditContext,
  nodeId: string,
  propPath: string,
  label: string
): FieldEditOutcome {
  const { editor, component } = context;
  const retired = additionRetired(context.reserved);
  if ("reason" in retired) return retired;
  return applyFieldEdit(
    editor,
    component,
    planExposeProperty(
      component,
      { nodeId, propPath, label },
      {
        definitions: editor.lockDefinitions,
        retired,
        limits: editor.limits,
      }
    )
  );
}

/** Let placements hide a node, through a new visibility field. */
export function exposeVisibility(
  context: FieldEditContext,
  nodeId: string,
  label: string
): FieldEditOutcome {
  const { editor, component } = context;
  const retired = additionRetired(context.reserved);
  if ("reason" in retired) return retired;
  return applyFieldEdit(
    editor,
    component,
    planExposeProperty(
      component,
      { nodeId, visibility: true, label },
      {
        definitions: editor.lockDefinitions,
        retired,
        limits: editor.limits,
      }
    )
  );
}

/** Rename a field; its id and every placement's value stay. */
export function renameField(
  context: Omit<FieldEditContext, "reserved">,
  id: string,
  label: string
): FieldEditOutcome {
  const { editor, component } = context;
  return applyFieldEdit(
    editor,
    component,
    planRenameExposure(component, id, label, editor.limits)
  );
}

/**
 * The removal of a field or an exposed slot, planned but not applied: the
 * dialog shows what it prunes before the author confirms.
 */
export function planFieldRemoval(
  component: ComponentDocument,
  removing: { readonly kind: "field" | "slot"; readonly id: string },
  limits: EditorState["limits"]
): ExposureEditResult {
  return removing.kind === "field"
    ? planRemoveExposure(component, removing.id, limits)
    : planRemoveExposedSlot(component, removing.id, limits);
}

/**
 * "at least 3 documents", "1 document", or nothing when the host could not
 * count. A floor of none says nothing, so it is not said.
 */
export function reachPhrase(
  reach: ComponentFieldsHost["reach"]
): string | undefined {
  if (reach === undefined) return undefined;
  if (reach.count === 0 && !reach.complete) return undefined;
  const noun = reach.count === 1 ? "document" : "documents";
  return reach.complete
    ? `${reach.count} ${noun}`
    : `at least ${reach.count} ${noun}`;
}

/**
 * What the removal dialog says about the placements and variants a removal
 * takes a value from.
 */
export function removalSentences(
  edit: ExposureEdit,
  removing: { readonly kind: "field" | "slot" },
  reach: ComponentFieldsHost["reach"]
): {
  readonly placements: string;
  readonly variants: readonly {
    readonly variant: string;
    readonly sentence: string;
  }[];
} {
  const where = reachPhrase(reach);
  const pages =
    where === undefined
      ? ""
      : reach?.count === 0 && reach.complete
        ? " No document places this component yet."
        : ` This component is placed directly in ${where}.`;
  const placements =
    removing.kind === "field"
      ? `When you publish this component, every use of it that set this field loses its value.${pages}`
      : `When you publish this component, the blocks each use of it added here are removed.${pages}`;
  const variants = edit.prunedVariants.map(variant => ({
    variant: variant.variant,
    sentence: variant.emptied
      ? `${variant.label}: loses its value, and with nothing left it shows the defaults`
      : `${variant.label}: loses its value`,
  }));
  return { placements, variants };
}

/** What a field's source line says of a block that is no longer there. */
const MISSING_BLOCK = "A missing block";

/**
 * Where a field comes from, in the words an author reads: the block and the
 * property, by the names the block gives them, never a stored prop name or an
 * id. "Heading text", "Button link"; the block alone where the property is
 * named as the block is ("Image"); and "Heading · level" where the plain line
 * would only repeat the field's own name. A visibility field says what it
 * does instead, since it drives no property.
 */
export function fieldSource(
  document: BlockDocument,
  field: ExposedProperty
): string {
  const node = findNode(document.nodes, field.nodeId);
  if (node === undefined) return MISSING_BLOCK;
  const block = blockLabel(node.type);
  if (field.type === "visibility") return `${block}, shown or hidden`;
  const prop = inSentence(propWord(node.type, field.propPath));
  if (prop.toLowerCase() === block.toLowerCase()) return block;
  const line = `${block} ${prop}`;
  return line.toLowerCase() === field.label.trim().toLowerCase()
    ? `${block} · ${prop}`
    : line;
}

/** Where an exposed slot sits, and what each placement does with it. */
export function slotSource(
  component: ComponentDocument,
  slotId: string
): string {
  const slots: unknown = component.slots;
  const slot = isPlainRecord(slots) ? slots[slotId] : undefined;
  const nodeId = isPlainRecord(slot) ? slot.nodeId : undefined;
  const node =
    typeof nodeId === "string" ? findNode(component.nodes, nodeId) : undefined;
  if (node === undefined) return MISSING_BLOCK;
  return `${blockLabel(node.type)}, filled by each use`;
}

/**
 * What the block calls the property a path starts at: its own label, or the
 * name spaced when it gives none.
 */
function propWord(type: string, propPath: string): string {
  const head = propPath.split(".", 1)[0] ?? propPath;
  const schema = getBlock(type)?.props?.[head];
  return schema === undefined ? fieldLabel(head) : propLabel(head, schema);
}

/**
 * A label as it reads mid-sentence: its first letter lowered, unless the
 * label opens with an acronym ("URL"), which keeps its capitals.
 */
function inSentence(label: string): string {
  const second = label.charAt(1);
  if (
    second !== "" &&
    second === second.toUpperCase() &&
    /[A-Z]/.test(second)
  ) {
    return label;
  }
  return label.charAt(0).toLowerCase() + label.slice(1);
}
