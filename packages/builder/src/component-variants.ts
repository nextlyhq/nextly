/**
 * What a designer does to a component's variants in its own view, and what a
 * placement's variant picker offers.
 *
 * Decides and draws nothing: the op an edit becomes, the sentences an author
 * reads and what a placement's choice resolves to all live here, where they
 * can be asserted without a DOM. `component-variants-panel` and
 * `variant-picker` draw them.
 *
 * Every definition edit is asked of the engine's variant planners, which hold
 * the rules (a key is the variant's id and is never reused, names are unique,
 * an empty variant is kept), and written as ONE `envelope` op, so it is one
 * undo step and reaches autosave and recovery with the rest of the document.
 *
 * @module component-variants
 */
import {
  COMPONENT_INSTANCE_TYPE,
  instanceExposure,
  isPlainRecord,
  planAddVariant,
  planDeleteVariant,
  planRenameVariant,
  planResetVariantValue,
  planSetVariantValue,
  variantLabelKey,
  variantOptions,
  type BlockNode,
  type ComponentDocument,
  type OverrideValue,
  type VariantEditProblem,
  type VariantEditResult,
  type VariantOption,
} from "@nextlyhq/blocks-engine";

import { envelopeOpFor } from "./component-fields";
import type { EditorState } from "./editor-state";
import type { BuilderOp } from "./op-vocabulary";

/**
 * How many placements chose a variant, for the delete dialog.
 *
 * @experimental Settles when the component editor ships.
 */
export interface VariantUse {
  /** Placements that chose it. */
  readonly placements: number;
  /** The documents holding them: pages, Singles, components and patterns. */
  readonly documents: number;
  /**
   * False when the count is a floor: the usage index did not list every host,
   * or a host could not be read. Said as "at least".
   */
  readonly complete: boolean;
}

/**
 * What the host knows about a component's variants that its document does not
 * hold.
 *
 * @experimental Settles when the component editor ships.
 */
export interface ComponentVariantsHost {
  /**
   * Counts the placements that chose a variant, across every document that
   * places the component. Absent where the host cannot count; the delete
   * dialog then says the placements fall back without a number.
   */
  readonly countUse?: (variantId: string) => Promise<VariantUse>;
  /**
   * Which variant is open, held by the host so the canvas can preview it.
   * Absent, the section holds it alone and the canvas draws the defaults.
   */
  readonly preview?: VariantPreviewBinding;
}

/** The open variant, as the host holds it for the canvas to preview. */
export interface VariantPreviewBinding {
  /** The open variant's id, or nothing while none is open. */
  readonly open: string | undefined;
  /** Open a variant, or close the open one with `undefined`. */
  readonly onOpen: (variantId: string | undefined) => void;
}

/** What the variant edits read from the editor, gathered once. */
export interface VariantEditContext {
  readonly editor: Pick<EditorState, "apply" | "limits">;
  readonly component: ComponentDocument;
  /**
   * Keys a new variant must not take though the component no longer holds
   * them: every key this editing session has seen, so a variant deleted and
   * added again under its old name does not inherit the old one's placements.
   */
  readonly taken: readonly string[];
}

/** What an edit came to: applied, or refused with the sentence to show. */
export type VariantEditOutcome =
  | { readonly applied: true; readonly id: string }
  | { readonly applied: false; readonly reason: string };

/** The sentence for each refusal, said where the edit was made. */
function problemSentence(
  problem: VariantEditProblem,
  clash?: string,
  needs?: string
): string {
  switch (problem) {
    case "invalid-value":
      return `Not saved: this field ${needs ?? "needs a different value"}.`;
    case "invalid-label":
      return "A variant needs a name.";
    case "label-taken":
      return `There is already a variant called “${clash ?? ""}”. Choose another name.`;
    case "unknown-variant":
      return "That variant is no longer on this component.";
    case "unknown-exposure":
      return "That field is no longer on this component.";
    case "not-a-component":
      return "Variants belong to components, and this is not one.";
    case "exceeds-limits":
      return "This component is at its size limit, so nothing more can be added.";
    case "invalid-variant":
      return "This component’s variants can’t be read, so they can’t be changed here.";
    default:
      return "This change could not be made.";
  }
}

/** Apply a planned edit as one op, or say why it was not. */
function applied(
  context: VariantEditContext,
  result: VariantEditResult
): VariantEditOutcome {
  if ("problem" in result) {
    return {
      applied: false,
      reason: problemSentence(result.problem, result.clash, result.needs),
    };
  }
  const op = envelopeOpFor(context.component, result.document);
  if (op === undefined) return { applied: true, id: result.id };
  return context.editor.apply(op) === null
    ? {
        applied: false,
        reason: "This change could not be applied here. Nothing was changed.",
      }
    : { applied: true, id: result.id };
}

/**
 * A name for a new variant no other variant has: "Variant 2" when there is
 * one already, and so on. The designer renames it in place.
 */
export function nextVariantName(component: ComponentDocument): string {
  const taken = new Set(
    variantOptions(component).map(option => variantLabelKey(option.label))
  );
  for (let n = taken.size + 1; ; n += 1) {
    const name = `Variant ${String(n)}`;
    if (!taken.has(variantLabelKey(name))) return name;
  }
}

/** Define a variant. It presets nothing until it is given values. */
export function addVariant(
  context: VariantEditContext,
  label: string
): VariantEditOutcome {
  return applied(
    context,
    planAddVariant(context.component, label, {
      taken: context.taken,
      limits: context.editor.limits,
    })
  );
}

/** Rename a variant; every placement that chose it keeps it. */
export function renameVariant(
  context: VariantEditContext,
  id: string,
  label: string
): VariantEditOutcome {
  return applied(
    context,
    planRenameVariant(context.component, id, label, context.editor.limits)
  );
}

/** Delete a variant; its placements show the defaults with their own values. */
export function deleteVariant(
  context: VariantEditContext,
  id: string
): VariantEditOutcome {
  return applied(
    context,
    planDeleteVariant(context.component, id, context.editor.limits)
  );
}

/** Set what a variant presets for one field. */
export function setVariantValue(
  context: VariantEditContext,
  id: string,
  fieldId: string,
  value: OverrideValue
): VariantEditOutcome {
  return applied(
    context,
    planSetVariantValue(
      context.component,
      id,
      fieldId,
      value,
      context.editor.limits
    )
  );
}

/** Take a variant's value for one field away, back to the default. */
export function resetVariantValue(
  context: VariantEditContext,
  id: string,
  fieldId: string
): VariantEditOutcome {
  return applied(
    context,
    planResetVariantValue(context.component, id, fieldId, context.editor.limits)
  );
}

/**
 * The component's own value for each exposed field, by field id: what a
 * variant that sets nothing for a field shows.
 *
 * Read from what the resolver itself makes of a placement that sets nothing,
 * once for the whole component, so a visibility field gated by its node's
 * conditions reads as hidden, and a field the resolver cannot use has no
 * value, exactly as a page shows them.
 */
export function defaultValues(
  component: ComponentDocument
): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>();
  for (const row of instanceExposure(component, UNPLACED).properties) {
    if (!values.has(row.property.id)) {
      values.set(row.property.id, row.cleared ? undefined : row.value);
    }
  }
  return values;
}

/** A placement that chooses nothing and sets nothing. */
const UNPLACED: BlockNode = {
  id: "",
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "" },
};

/** How many values a variant presets, in words: "2 changes", "No changes yet". */
export function valuesSummary(option: VariantOption): string {
  if (option.empty) return "No changes yet";
  const count = Object.keys(option.values).length;
  return count === 1 ? "1 change" : `${String(count)} changes`;
}

/**
 * What the delete dialog says will happen to the variant's placements.
 *
 * `undefined` use is a count still in flight; `null` is one that could not be
 * made, which says what happens without a number rather than "none".
 */
export function deleteSentence(use: VariantUse | null | undefined): string {
  const after =
    "Each use of this variant will show the component’s defaults, and keep its own changes.";
  if (use === undefined) return "Counting where it is used…";
  if (use === null) {
    return `Where it is used could not be counted. ${after}`;
  }
  if (use.placements === 0) {
    return use.complete
      ? "Nothing uses this variant."
      : "Nothing was found using this variant, though not every page could be checked.";
  }
  const floor = use.complete ? "" : "at least ";
  const times = `${floor}${String(use.placements)} ${use.placements === 1 ? "time" : "times"}`;
  const documents = `${floor}${String(use.documents)} ${use.documents === 1 ? "document" : "documents"}`;
  return `Used ${times} in ${documents}. ${after}`;
}

/**
 * A placement's variant, as its picker shows it.
 *
 * @experimental Settles when the component editor ships.
 */
export interface VariantChoice {
  /** The variants the component offers, in its stored order. */
  readonly options: readonly VariantOption[];
  /** The key the placement stores, if any. */
  readonly chosen?: string;
  /**
   * True when the stored key names a variant the component no longer has:
   * the placement then shows the defaults, and the picker says so.
   */
  readonly removed: boolean;
}

/** What a placement's picker offers and shows, read off the definition. */
export function variantChoiceOf(
  definition: ComponentDocument | undefined,
  node: BlockNode
): VariantChoice {
  const options = variantOptions(definition);
  const stored = isPlainRecord(node.props) ? node.props.variant : undefined;
  if (typeof stored !== "string" || stored === "") {
    return { options, removed: false };
  }
  return {
    options,
    chosen: stored,
    removed: !options.some(option => option.id === stored),
  };
}

/**
 * The op that sets a placement's variant, or clears it with `undefined`.
 *
 * The whole props object, as every placement op writes it: `updateNode`
 * merges at the top level, so a patch of the one key would drop the
 * component's id. Clearing removes the key, since absent is "no variant".
 */
export function chooseVariantOp(
  node: BlockNode,
  variantId: string | undefined
): BuilderOp {
  const { variant: _stored, ...rest } = isPlainRecord(node.props)
    ? node.props
    : {};
  return {
    kind: "update",
    id: node.id,
    patch: {
      props: variantId === undefined ? rest : { ...rest, variant: variantId },
    },
  };
}
