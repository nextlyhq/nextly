/**
 * Defining, renaming and deleting a component's variants, and setting the
 * values each one presets.
 *
 * A variant is a named set of the component's exposed values. A placement
 * stores the variant's KEY, the id it is filed under in `variants`, and folds
 * its values in before its own (`resolve-instances`). These planners are what a
 * designer does to them in the component's own view, and the rules they hold:
 *
 * - **The key is the variant's id.** It is never derived from the label, so a
 *   rename changes the label and nothing else, and every placement that chose
 *   the variant keeps it. Keys already stored stay as they are.
 * - **A new key is opaque and never one in use.** It is minted at random, past
 *   every live key and every key the caller says to avoid (the published
 *   definition's, which placements may still hold while a draft has deleted
 *   it). A deleted key is never given to another variant, so a placement still
 *   holding it falls back to the defaults rather than picking up a stranger,
 *   and restoring a version that held the variant brings back its placements.
 * - **Labels are unique per component,** trimmed and compared without case. A
 *   clash is refused, naming the variant that already has the label.
 * - **A variant may preset nothing.** A new one starts empty, and a removed
 *   field can empty one; it renders the defaults and the save warns
 *   (`variant-empty`).
 * - **The result passes the envelope check** the definition's own save runs,
 *   asked through `componentEnvelopeIssues` rather than restated.
 *
 * Each planner is pure and returns the whole edited definition, so the dry run
 * and the write are the same object.
 *
 * @module variant-planners
 */
import { editableComponent, editVerdict } from "./component-edit";
import type {
  BlockDocument,
  ComponentDocument,
  ExposedProperty,
  OverrideValue,
  Variant,
} from "./document";
import {
  DEFAULT_LIMITS,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "./limits";
import { exposedValueFits, neededFor } from "./placement-values";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import type { ValidationIssue } from "./validation";
import { variantLabelKey } from "./variant-labels";

/**
 * Why a variant edit was refused.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export type VariantEditProblem =
  /** The document is not a component definition, or cannot be read as one. */
  | "not-a-component"
  /** No variant has that key. */
  | "unknown-variant"
  /** The component exposes no field with that id. */
  | "unknown-exposure"
  /** The value is not one the field takes; `needs` says what it takes. */
  | "invalid-value"
  /** The label is blank. */
  | "invalid-label"
  /** Another variant already has the label, ignoring case and spaces. */
  | "label-taken"
  /** The edited envelope would fail the definition's own save. */
  | "invalid-variant"
  /** The edited definition would be past the host's caps. */
  | "exceeds-limits";

/**
 * An edit the definition's save would accept.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface VariantEdit {
  /** The whole edited definition. The one passed in is never changed. */
  readonly document: ComponentDocument;
  /** The key of the variant the edit is about: added, renamed, set or deleted. */
  readonly id: string;
  /** What the definition's save would warn about, such as an empty variant. */
  readonly warnings: readonly ValidationIssue[];
}

/**
 * A refused variant edit.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface VariantEditRefusal {
  readonly problem: VariantEditProblem;
  /** For `"label-taken"`: the label of the variant that already has it. */
  readonly clash?: string;
  /** For `"invalid-value"`: what the field takes, as in "needs text". */
  readonly needs?: string;
  /** The envelope errors, for `"invalid-variant"`. */
  readonly issues?: readonly ValidationIssue[];
}

/**
 * What every planner here answers: the edit, or why it was refused.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export type VariantEditResult = VariantEdit | VariantEditRefusal;

/**
 * What adding a variant reads besides the definition.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface NewVariantSources {
  /**
   * Keys the new variant must not take though the definition no longer holds
   * them: the published definition's, while a draft has deleted one.
   */
  readonly taken?: Iterable<string>;
  /** Mints a candidate key. Defaults to an opaque random one. */
  readonly mintKey?: () => string;
  /** The host's document limits, which its save judges the definition under. */
  readonly limits?: DocumentLimits;
}

/**
 * One variant as a picker offers it.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export interface VariantOption {
  /** The key placements store. */
  readonly id: string;
  /** What the picker calls it: the stored label, or the key when it has none. */
  readonly label: string;
  /** True when it presets nothing, so choosing it shows the defaults. */
  readonly empty: boolean;
  /** The values it presets, keyed by exposed field id. */
  readonly values: Readonly<Record<string, OverrideValue>>;
}

/**
 * The variants a component offers, in their stored order, read defensively.
 *
 * An entry that is not a record, or is filed under the empty key, is left
 * out: the envelope check names the first on save, and a picker cannot offer
 * either as anything a placement keeps. A stored label that is blank
 * reads as the key, so every option has words.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function variantOptions(
  definition: BlockDocument | undefined
): readonly VariantOption[] {
  if (!isPlainRecord(definition)) return [];
  const variants: unknown = definition.variants;
  if (!isPlainRecord(variants)) return [];
  const options: VariantOption[] = [];
  for (const id of boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES) ?? []) {
    const variant: unknown = ownEntry(variants, id);
    // An empty key is left out too: a placement storing it reads as having
    // chosen no variant, so offering it would offer a choice that never holds.
    if (id === "" || !isPlainRecord(variant)) continue;
    const label = cleanLabel(variant.label) ?? id;
    const values = isPlainRecord(variant.overrides) ? variant.overrides : {};
    const keys = boundedOwnKeys(values, MAX_ENVELOPE_ENTRIES);
    options.push({
      id,
      label,
      empty: keys !== null && keys.length === 0,
      values: values,
    });
  }
  return options;
}

/**
 * Define a new variant under a fresh opaque key. It presets nothing until the
 * designer gives it values.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planAddVariant(
  definition: BlockDocument,
  label: string,
  sources: NewVariantSources = {}
): VariantEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const clean = cleanLabel(label);
  if (clean === undefined) return { problem: "invalid-label" };
  const variants = draft.variants ?? {};
  const clash = labelClash(variants, clean, undefined);
  if (clash !== undefined) return { problem: "label-taken", clash };

  const taken = new Set<string>(sources.taken);
  for (const key of Object.keys(variants)) taken.add(key);
  const id = freshKey(taken, sources.mintKey ?? opaqueKey);
  draft.variants = { ...variants, [id]: { label: clean, overrides: {} } };
  return finished(draft, id, sources.limits);
}

/**
 * Rename a variant. Its key, and so every placement that chose it, is kept.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planRenameVariant(
  definition: BlockDocument,
  id: string,
  label: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): VariantEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const clean = cleanLabel(label);
  if (clean === undefined) return { problem: "invalid-label" };
  const variant = variantAt(draft, id);
  if (variant === undefined) return { problem: "unknown-variant" };
  const clash = labelClash(draft.variants ?? {}, clean, id);
  if (clash !== undefined) return { problem: "label-taken", clash };

  draft.variants = { ...draft.variants, [id]: { ...variant, label: clean } };
  return finished(draft, id, limits);
}

/**
 * Delete a variant.
 *
 * Placements that chose it keep its key: they render the component's defaults
 * with their own values over them, and resolve to the variant again if a
 * restored version brings it back. Deleting the last variant removes the
 * record, since absent is how a component says it has none.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planDeleteVariant(
  definition: BlockDocument,
  id: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): VariantEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  if (variantAt(draft, id) === undefined) return { problem: "unknown-variant" };

  const { [id]: _deleted, ...kept } = draft.variants ?? {};
  if (Object.keys(kept).length === 0) delete draft.variants;
  else draft.variants = kept;
  return finished(draft, id, limits);
}

/**
 * Set the value a variant presets for one exposed field, or `$unset` to have
 * it clear the field.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planSetVariantValue(
  definition: BlockDocument,
  id: string,
  exposureId: string,
  value: OverrideValue,
  limits: DocumentLimits = DEFAULT_LIMITS
): VariantEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const variant = variantAt(draft, id);
  if (variant === undefined) return { problem: "unknown-variant" };
  const field = exposure(draft, exposureId);
  if (field === undefined) return { problem: "unknown-exposure" };
  // Held to what a placement may set for the field, so a variant never
  // presets a value the placement inspector or a page write would refuse.
  if (!exposedValueFits(field, value)) {
    return { problem: "invalid-value", needs: neededFor(field) };
  }

  const overrides = { ...readOverrides(variant), [exposureId]: value };
  draft.variants = { ...draft.variants, [id]: { ...variant, overrides } };
  return finished(draft, id, limits);
}

/**
 * Take a variant's value for one field away, so the field shows the
 * component's default under it. Removing its last value leaves the variant
 * presetting nothing, which the save warns about and keeps.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function planResetVariantValue(
  definition: BlockDocument,
  id: string,
  exposureId: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): VariantEditResult {
  const draft = editable(definition);
  if ("problem" in draft) return draft;
  const variant = variantAt(draft, id);
  if (variant === undefined) return { problem: "unknown-variant" };
  const current = readOverrides(variant);
  if (!Object.hasOwn(current, exposureId)) {
    return { problem: "unknown-exposure" };
  }

  const { [exposureId]: _removed, ...overrides } = current;
  draft.variants = { ...draft.variants, [id]: { ...variant, overrides } };
  return finished(draft, id, limits);
}

/** A copy of the definition to edit, or why it cannot be edited. */
function editable(
  definition: BlockDocument
): ComponentDocument | VariantEditRefusal {
  const draft = editableComponent(definition);
  if (draft === "not-a-component") return { problem: "not-a-component" };
  if ("issues" in draft) {
    return { problem: "invalid-variant", issues: draft.issues };
  }
  return draft;
}

/** The variant stored under a key, own keys only, when it is a record. */
function variantAt(
  definition: ComponentDocument,
  id: string
): Variant | undefined {
  const variants = definition.variants;
  if (!isPlainRecord(variants)) return undefined;
  const variant: unknown = ownEntry(variants, id);
  return isPlainRecord(variant) ? (variant as unknown as Variant) : undefined;
}

/** A variant's values, or none when the stored record is not one. */
function readOverrides(variant: Variant): Record<string, OverrideValue> {
  const overrides: unknown = variant.overrides;
  return isPlainRecord(overrides) ? overrides : {};
}

/** The field the component exposes under this id, when it is readable. */
function exposure(
  definition: ComponentDocument,
  exposureId: string
): ExposedProperty | undefined {
  const exposed: unknown = definition.exposed;
  if (!Array.isArray(exposed)) return undefined;
  const found: unknown = exposed.find(
    entry => isPlainRecord(entry) && entry.id === exposureId
  );
  return isPlainRecord(found) && typeof found.type === "string"
    ? (found as unknown as ExposedProperty)
    : undefined;
}

/** A label trimmed, or `undefined` when nothing is left. */
function cleanLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const trimmed = label.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The label of another variant that already has this name, if one does.
 * `self` is the variant being renamed, which may keep its own name in another
 * case.
 */
function labelClash(
  variants: Readonly<Record<string, unknown>>,
  label: string,
  self: string | undefined
): string | undefined {
  const wanted = variantLabelKey(label);
  for (const key of boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES) ?? []) {
    if (key === self) continue;
    const other: unknown = ownEntry(variants, key);
    const otherLabel = isPlainRecord(other)
      ? cleanLabel(other.label)
      : undefined;
    if (otherLabel !== undefined && variantLabelKey(otherLabel) === wanted) {
      return otherLabel;
    }
  }
  return undefined;
}

/**
 * An opaque variant key: a prefix that says what it is, and enough random
 * hex that two keys minted anywhere do not meet.
 */
function opaqueKey(): string {
  return `v-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** The first minted key nothing has taken. */
function freshKey(taken: ReadonlySet<string>, mint: () => string): string {
  for (;;) {
    const key = mint();
    if (key !== "" && !taken.has(key)) return key;
  }
}

/** The edit, or the envelope errors that would refuse its save. */
function finished(
  document: ComponentDocument,
  id: string,
  limits: DocumentLimits = DEFAULT_LIMITS
): VariantEditResult {
  const judged = editVerdict(document, limits);
  if (judged.verdict === "exceeds-limits") return { problem: "exceeds-limits" };
  if (judged.verdict === "refused") {
    return { problem: "invalid-variant", issues: judged.errors };
  }
  return { document, id, warnings: judged.warnings };
}
