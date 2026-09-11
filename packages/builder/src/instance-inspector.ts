/**
 * What a selected component INSTANCE exposes for editing, and the patch that
 * changes it.
 *
 * Pure, for the reason `inspector.ts` is: which rows an instance offers, what
 * each shows and where its value came from is derivation, and a component
 * test in jsdom cannot separate a correct answer from a plausible wrong one.
 *
 * **An instance is not a block.** Its node's type is not in the registry, so
 * the block inspector answers nothing for it; and what it holds is not props
 * but OVERRIDES — values keyed by the definition's exposed-property ids, each
 * either absent (inherit), a value (replace) or the `$unset` sentinel (clear).
 * The definition decides what may be overridden and the resolver decides what
 * is in force, so this module asks both and draws nothing of its own.
 *
 * **The rows are the resolver's answer.** `instanceExposure` applies the
 * overrides in force with the same writer the renderer uses and reads every
 * row's value back from the result, so a row here shows what the page shows.
 * A second derivation beside it — reading the override record directly — would
 * agree until two exposures pointed at one path, and then disagree silently.
 *
 * @module instance-inspector
 */

import {
  findNode,
  instanceExposure,
  isComponentInstance,
  readableDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type ExposedPropertyType,
  type ExposedValueSource,
  type OverrideValue,
} from "@nextlyhq/blocks-engine";

import type { SavedComponent } from "./inserter";
import type { BlockIdentity } from "./inspector";
import type { BuilderOp, NodePatch } from "./ops";

/**
 * The exposed types this inspector can draw a control for.
 *
 * Named as a set rather than inferred from what the switch happens to handle,
 * for the reason `SUPPORTED_PROP_TYPES` is: an exposed type with no control is
 * a KNOWN gap the row states, never a silent fallthrough. A link is edited as
 * the address its prop holds and visibility as shown-or-hidden; rich text and
 * images have no control here yet — a passage is edited on the canvas, and an
 * image needs a picker this package cannot reach — and a row of either still
 * shows its value and its source, and still offers a reset, because
 * withholding the row would present a component as exposing less than it
 * does.
 */
export const EDITABLE_EXPOSED_TYPES = [
  "text",
  "select",
  "link",
  "visibility",
] as const;

/** One exposed property, with everything a row needs to draw itself. */
export interface ExposedRow {
  /** The definition's stable id for the property, which the override is keyed by. */
  readonly id: string;
  readonly label: string;
  readonly type: ExposedPropertyType;
  /**
   * The value in force, read back from the resolver's own result.
   *
   * `undefined` for a cleared row and for a definition that holds nothing
   * there; {@link cleared} separates the two.
   */
  readonly value: OverrideValue;
  /**
   * Which layer supplied the value IN FORCE at this row's target: the
   * definition, a variant, or this instance.
   *
   * The target's, not the row's: two exposures aimed at one target share a
   * value, and the resolver reports the winning exposure's source on both.
   * What this row itself stores is {@link ownOverride}.
   */
  readonly source: ExposedValueSource;
  /** True when the author cleared the property rather than inheriting or setting it. */
  readonly cleared: boolean;
  /**
   * Whether THIS instance's record holds a value under this row's id — set
   * or cleared. What a reset would remove, and so whether one is offered: a
   * row shadowed by a neighbour that holds the override reads `instance` as
   * its source and has nothing of its own to reset.
   */
  readonly ownOverride: boolean;
  /** Whether this inspector can draw a control for it. Carried, not recomputed. */
  readonly supported: boolean;
  /** The choices, for `select` only; empty for every other type. */
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  /**
   * The exposure actually in force at this row's target, when it is not this
   * one — carried with its label so the row can NAME what shadows it rather
   * than pointing at an id an author has never seen.
   */
  readonly shadowedBy?: { readonly id: string; readonly label: string };
}

/**
 * A value this instance stores for a property the definition no longer
 * exposes.
 *
 * Surfaced rather than dropped, and separately from the rows: it is not a
 * property any more, so it has no label, no type and no control — only the
 * stored value and the offer to discard it. An author whose override
 * disappeared the moment somebody else edited the component is told, and
 * chooses.
 */
export interface OrphanedOverride {
  readonly id: string;
  readonly value: OverrideValue;
}

/** The selected instance, as something to edit. */
export interface InstanceInspection {
  readonly nodeId: string;
  readonly componentId: string;
  /** What the node IS, beside what it overrides: its own name and lock. */
  readonly identity: BlockIdentity;
  /**
   * What to title the panel: the library's title for the definition, or the
   * id when the library has no row for it.
   */
  readonly label: string;
  /** How many pages place this component, when the library can say. */
  readonly usedOn?: number;
  /**
   * Whether the lookup holds a definition for this instance.
   *
   * `false` is a state the panel has to draw rather than an error: the
   * canvas draws such an instance as could-not-be-loaded, and the panel says
   * the same thing in words. The rows are empty when this is false, and
   * empty when the definition exposes nothing — the flag is what tells the
   * two apart.
   */
  readonly definitionFound: boolean;
  /** In the definition's own declared order, which is the order it designed. */
  readonly rows: readonly ExposedRow[];
  /** Overrides this instance holds for properties no longer exposed. */
  readonly orphaned: readonly OrphanedOverride[];
}

/**
 * Describe the selected instance for editing, or `null` when the selection is
 * not an instance — no selection, an id the document no longer holds, or an
 * ordinary block, which the block inspector answers for.
 *
 * `definitions` is the lookup the CANVAS resolves against, handed in rather
 * than fetched, so a row's value is read from the same document the page is
 * drawn from. `components` is the library's list, which is the only holder of
 * a definition's title and usage; the document itself carries neither.
 */
export function inspectInstance(
  document: BlockDocument,
  selectedId: string | null,
  definitions: ComponentLookup,
  components: readonly SavedComponent[]
): InstanceInspection | null {
  if (selectedId === null) return null;
  const node = findNode(document.nodes, selectedId);
  if (node === undefined || !isComponentInstance(node)) return null;

  const componentId = storedComponentId(node);
  const row = components.find(component => component.id === componentId);
  // Read under the resolver's OWN rule for a supplied definition, not the
  // kind alone: what the canvas leaves standing as a placeholder — a format
  // this build does not read, a list of nodes that is not one — must draw no
  // editable row here, and must not be handed to the exposure to throw on.
  const definition = readableDefinition(definitions.get(componentId));
  const found = definition !== undefined;
  const exposure = found ? instanceExposure(definition, node) : undefined;

  return {
    nodeId: node.id,
    componentId,
    identity: { name: node.name ?? "", locked: node.locked === true },
    label: row?.title ?? componentId,
    ...(row?.usedOn === undefined ? {} : { usedOn: row.usedOn }),
    definitionFound: found,
    rows: exposure === undefined ? [] : rowsOf(exposure.properties, node),
    orphaned:
      exposure === undefined
        ? []
        : orphanedOf(exposure.orphanedOverrideIds, node),
  };
}

/**
 * The component id the node stores, or an empty string for a node that names
 * none.
 *
 * Read defensively: a stored document can hold anything the database
 * returned, and a `componentId` that is not a string must not reach a lookup
 * typed for one. An empty id resolves to no definition, which the panel then
 * says.
 */
function storedComponentId(node: BlockNode): string {
  const id = node.props.componentId;
  return typeof id === "string" ? id : "";
}

/** The resolver's rows, as the panel draws them. */
function rowsOf(
  properties: ReturnType<typeof instanceExposure>["properties"],
  node: BlockNode
): ExposedRow[] {
  const labels = new Map(
    properties.map(state => [state.property.id, state.property.label] as const)
  );
  // Read off the node's own record rather than the resolver's source, which
  // is the target's and is shared by every exposure aimed at it.
  const stored = storedOverrides(node);
  return properties.map(state => ({
    id: state.property.id,
    label: state.property.label,
    type: state.property.type,
    value: state.value,
    source: state.source,
    cleared: state.cleared,
    ownOverride: Object.hasOwn(stored, state.property.id),
    supported: (EDITABLE_EXPOSED_TYPES as readonly string[]).includes(
      state.property.type
    ),
    options: state.property.options ?? [],
    ...(state.shadowedBy === undefined
      ? {}
      : {
          shadowedBy: {
            id: state.shadowedBy,
            label: labels.get(state.shadowedBy) ?? state.shadowedBy,
          },
        }),
  }));
}

/**
 * The orphaned overrides THIS INSTANCE holds.
 *
 * The resolver reports every orphaned id it applied, and it applies a
 * variant's overrides as well as the instance's own — but only the instance's
 * are this author's to discard, and only those are stored on this node. A
 * variant that carries a value for a property the definition dropped is the
 * definition's own concern.
 */
function orphanedOf(
  ids: readonly string[],
  node: BlockNode
): OrphanedOverride[] {
  const stored = storedOverrides(node);
  return ids.flatMap(id =>
    Object.hasOwn(stored, id) ? [{ id, value: stored[id] }] : []
  );
}

/**
 * The override record the node stores, or an empty one.
 *
 * Read defensively for the reason {@link storedComponentId} is, and through
 * an own-property view: the ids are exposed-property ids from a stored
 * definition, and a record read by plain property access answers
 * `constructor` with a function for a key it never had.
 */
function storedOverrides(node: BlockNode): Record<string, OverrideValue> {
  const overrides = node.props.overrides;
  if (typeof overrides !== "object" || overrides === null) return {};
  if (Array.isArray(overrides)) return {};
  return overrides as Record<string, OverrideValue>;
}

/**
 * The patch that replaces the instance's override record.
 *
 * **The whole props object, not the one key**, for the reason `propPatch`
 * states: `updateNode` merges at the top level, so a patch carrying only
 * `{ props: { overrides } }` would drop `componentId` and the node would name
 * no component at all. And the KEY IS OMITTED when nothing remains: the
 * record is optional, so absent is what "no overrides" already means
 * everywhere else, and a stored empty record would be a second spelling of
 * the same state that every reader would have to know about.
 */
export function overridesPatch(
  node: BlockNode,
  overrides: Readonly<Record<string, OverrideValue>>
): NodePatch {
  const { overrides: _stored, ...rest } = node.props;
  return {
    props: Object.keys(overrides).length === 0 ? rest : { ...rest, overrides },
  };
}

/**
 * The op that sets one override — a value, or the `$unset` sentinel to clear
 * the property rather than inherit it.
 *
 * Read from the node at call time rather than from a row: a control committing
 * on blur can fire after another edit replaced the node, and a record rebuilt
 * from an older copy would resurrect overrides that edit removed.
 */
export function setOverrideOp(
  node: BlockNode,
  id: string,
  value: OverrideValue
): BuilderOp {
  return {
    kind: "update",
    id: node.id,
    patch: overridesPatch(node, { ...storedOverrides(node), [id]: value }),
  };
}

/**
 * The op that removes one override, so the property inherits again.
 *
 * Removal rather than writing the definition's value back: an override equal
 * to the definition's value is still an override, and would go on shadowing
 * the definition the next time somebody edits the component.
 */
export function resetOverrideOp(node: BlockNode, id: string): BuilderOp {
  const { [id]: _removed, ...kept } = storedOverrides(node);
  return { kind: "update", id: node.id, patch: overridesPatch(node, kept) };
}
