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
  bindablePropKind,
  boundSettingId,
  findNode,
  getBlock,
  instanceExposure,
  isComponentInstance,
  isPlainRecord,
  keepsItsListWhenMoved,
  outerListOf,
  readableDefinition,
  settingBindingKey,
  type Binding,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
  type ExposedPropertyType,
  type ExposedValueSource,
  type OverrideValue,
  type PropSchema,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";

import type { RefusalWording } from "./canvas/drag-refusal";
import { composedHolds, composedHoldWording } from "./component-holds";
import { lockSourceOf, type BlockIdentity, type LockView } from "./inspector";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp, NodePatch } from "./op-vocabulary";
import type { SavedComponent } from "./panels/add/inserter";
import { instanceProps, storedComponentId } from "./placement-props";

/**
 * The exposed types this inspector can draw a control for.
 *
 * Named as a set rather than inferred from what the switch happens to handle,
 * for the reason `SUPPORTED_PROP_TYPES` is: an exposed type with no control is
 * a KNOWN gap the row states, never a silent fallthrough. A link is edited as
 * the address its prop holds, visibility as shown-or-hidden, and an image as
 * a file chosen from the host's media library, which the inspector hands the
 * panel. Rich text has no control here yet — a passage is edited on the
 * canvas — and its row still shows its value and its source, and still
 * offers a reset, because withholding the row would present a component as
 * exposing less than it does.
 */
export const EDITABLE_EXPOSED_TYPES = [
  "text",
  "select",
  "link",
  "visibility",
  "image",
  "richText",
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
  /**
   * Why this row is read-only, when a `contentOnly` lock holds what it drives:
   * a value that is not content, inside an area locked to its content. The
   * same rule a save applies to the composed page, so the panel holds exactly
   * what the store would refuse. Absent where the row may change.
   */
  readonly heldBy?: RefusalWording;
  /**
   * Where the setting may be bound to data: the schema of the component
   * block's prop it fills, named as the setting, which the binding picker
   * lists the fitting fields for. The placement's binding is written onto
   * that prop when the component is composed, so it is judged by that prop.
   * Absent for a setting no field fills.
   */
  readonly bindable?: PropSchema;
  /** The placement's binding of this setting, where it has one. */
  readonly binding?: Binding;
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
   * The variant this placement chose, by its stored key, with the label the
   * definition gives it; `label` is absent when the definition no longer
   * offers that variant. Absent when the placement chose none.
   */
  readonly variant?: { readonly key: string; readonly label?: string };
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
  components: readonly SavedComponent[],
  /**
   * The editor's lock source and composed page, for the rows a `contentOnly`
   * lock holds. Absent, no row is held by one.
   */
  view?: LockView
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
  const variant = variantOf(node, definition);
  const label = row?.title ?? componentId;
  const held = heldRows(node.id, view, label);

  return {
    nodeId: node.id,
    componentId,
    identity: { name: node.name ?? "", locked: node.locked === true },
    label,
    ...(row?.usedOn === undefined ? {} : { usedOn: row.usedOn }),
    ...(variant === undefined ? {} : { variant }),
    definitionFound: found,
    rows:
      exposure === undefined
        ? []
        : rowsOf(exposure.properties, node, definition, definitions).map(
            entry => {
              const reason = held(entry);
              return reason === undefined
                ? entry
                : { ...entry, heldBy: reason };
            }
          ),
    orphaned:
      exposure === undefined
        ? []
        : orphanedOf(exposure.orphanedOverrideIds, node),
  };
}

/**
 * The component a placement places, or `undefined` for a node that is not a
 * placement or names no component: what "Edit component" opens.
 */
export function placedComponentId(
  document: BlockDocument,
  nodeId: string
): string | undefined {
  const node = findNode(document.nodes, nodeId);
  if (node === undefined || !isComponentInstance(node)) return undefined;
  const id = storedComponentId(node);
  return id === "" ? undefined : id;
}

/**
 * What an author is told after double-clicking text a component does not
 * expose: whose it is, with the variant the placement uses, and where its
 * editable fields are. The placement is selected, so the panel beside it is
 * the one this points to.
 */
export function partOfComponentSentence(
  inspection: Pick<InstanceInspection, "label" | "variant" | "rows">,
  /**
   * The exposure feeding the text, when a lock the component sets holds it:
   * the sentence is then that row's reason, the one the panel shows.
   */
  heldExposureId?: string
): string {
  const held =
    heldExposureId === undefined
      ? undefined
      : inspection.rows.find(row => row.id === heldExposureId)?.heldBy;
  if (held !== undefined) return refusalAnnouncement(held);
  const variant =
    inspection.variant?.label === undefined
      ? ""
      : `, ${inspection.variant.label} variant`;
  const where =
    inspection.rows.length === 0
      ? "Its content is edited on the component itself."
      : "Its fields are in the panel; the rest is edited on the component itself.";
  return `Part of ${inspection.label}${variant}. ${where}`;
}

/**
 * The variant the placement chose, with the definition's label for it.
 *
 * Read off the definition's own record by the stored key, own keys only, as
 * the resolver reads it: a key the definition no longer offers is still the
 * placement's choice, and the panel says it is gone rather than hiding it.
 */
function variantOf(
  node: BlockNode,
  definition: ComponentDocument | undefined
): InstanceInspection["variant"] {
  const key = instanceProps(node).variant;
  if (typeof key !== "string" || key === "") return undefined;
  const variants: unknown = definition?.variants;
  const chosen =
    typeof variants === "object" &&
    variants !== null &&
    Object.hasOwn(variants, key)
      ? (variants as Record<string, unknown>)[key]
      : undefined;
  const label =
    typeof chosen === "object" && chosen !== null
      ? (chosen as { label?: unknown }).label
      : undefined;
  return typeof label === "string" && label.trim() !== ""
    ? { key, label }
    : chosen === undefined
      ? { key }
      : { key, label: key };
}

/**
 * Which rows of this placement are held, and why: a value landing on a block
 * the component locks in Layers, or one that is not content inside an area
 * locked to its content (`composedHolds`, the judgement the canvas's inline
 * text asks too).
 *
 * Asked of the COMPOSED page, where the placement's values land inside its
 * component's nodes: the resolver's exposure map names the node and prop each
 * exposure drives there. A visibility row is mapped to the node it shows or
 * hides, and showing a node is its design, never its content; a node it
 * currently hides is not composed, so its row is not held.
 */
function heldRows(
  placementId: string,
  view: LockView | undefined,
  componentName: string
): (row: ExposedRow) => RefusalWording | undefined {
  const composed = view?.composed;
  if (composed === undefined) return () => undefined;
  const holds = composedHolds(composed, lockSourceOf(view));
  const targets = new Map<string, { node: ResolvedBlockNode; path: string }>();
  for (const composedNode of composedNodesOf(composed.nodes, placementId)) {
    const fed = composedNode.exposedProps;
    if (fed === undefined) continue;
    for (const path of Object.keys(fed)) {
      const id = fed[path]?.id;
      if (typeof id === "string") targets.set(id, { node: composedNode, path });
    }
  }
  return row => {
    const target = targets.get(row.id);
    if (target === undefined) return undefined;
    const prop = target.path.split(".")[0] ?? target.path;
    const hold = holds(target.node, prop, row.type === "visibility");
    return hold === undefined
      ? undefined
      : composedHoldWording(hold, componentName, target.node.type);
  };
}

/** The composed nodes a placement contributed, in document order. */
function composedNodesOf(
  nodes: readonly ResolvedBlockNode[],
  placementId: string
): ResolvedBlockNode[] {
  const found: ResolvedBlockNode[] = [];
  const queue = [...nodes];
  for (let head = 0; head < queue.length; head += 1) {
    const entry = queue[head];
    if (typeof entry !== "object" || entry === null) continue;
    if (entry.instanceOf === placementId) found.push(entry);
    const slots: unknown = entry.slots;
    if (typeof slots !== "object" || slots === null) continue;
    for (const children of Object.values(slots as Record<string, unknown>)) {
      if (Array.isArray(children))
        queue.push(...(children as ResolvedBlockNode[]));
    }
  }
  return found;
}

/**
 * The setting types a placement may bind to data: those whose value a field
 * can be, text, an address and a picture. A choice is a design decision, and
 * whether a block is shown is decided by its conditions.
 */
const BINDABLE_SETTING_TYPES: ReadonlySet<string> = new Set([
  "text",
  "link",
  "image",
]);

/** An exposed property, as the resolver's rows carry it. */
type Exposure = ReturnType<
  typeof instanceExposure
>["properties"][number]["property"];

/**
 * How many components inside components a setting is followed through to
 * its block: the resolver's own depth is the real bound, this only stops a
 * stored loop.
 */
const MOST_NESTED_SETTINGS = 16;

/** Where a setting lands: a block of a component, and a prop path on it. */
interface SettingTarget {
  readonly definition: ComponentDocument;
  readonly nodeId: string;
  readonly propPath: string;
}

/** A block's declared prop, or `undefined` for one it does not declare. */
function blockPropOf(
  node: BlockNode,
  propPath: string
): PropSchema | undefined {
  const declared = getBlock(node.type)?.props;
  return declared === undefined || !Object.hasOwn(declared, propPath)
    ? undefined
    : declared[propPath];
}

/** A component's setting by its id, where it fills a prop. */
function propSettingOf(
  definition: ComponentDocument,
  id: string
): Exposure | undefined {
  const exposed: unknown = definition.exposed;
  if (!Array.isArray(exposed)) return undefined;
  return (exposed as unknown[]).find(
    (entry): entry is Exposure =>
      isPlainRecord(entry) &&
      entry.id === id &&
      typeof entry.nodeId === "string" &&
      typeof entry.propPath === "string" &&
      entry.type !== "visibility"
  );
}

/**
 * The next target of a setting aimed at a component placed inside the
 * component: that component's own setting the path names
 * (`overrides.<id>`), or `undefined` where it has none.
 */
function nestedTargetOf(
  placement: BlockNode,
  propPath: string,
  definitions: ComponentLookup
): SettingTarget | undefined {
  const id = boundSettingId(propPath);
  if (id === undefined) return undefined;
  const definition = readableDefinition(
    definitions.get(storedComponentId(placement))
  );
  const setting =
    definition === undefined ? undefined : propSettingOf(definition, id);
  return definition === undefined || setting === undefined
    ? undefined
    : { definition, nodeId: setting.nodeId, propPath: setting.propPath };
}

/**
 * The prop of a block a setting fills, as the block declares it: followed
 * through a component placed inside the component, whose setting it feeds
 * (`overrides.<id>`), to the block that setting fills in turn.
 */
function declaredPropOf(
  start: SettingTarget,
  definitions: ComponentLookup
): PropSchema | undefined {
  let target: SettingTarget | undefined = start;
  for (let step = 0; step < MOST_NESTED_SETTINGS; step += 1) {
    if (target === undefined) return undefined;
    const node = findNode(target.definition.nodes, target.nodeId);
    if (node === undefined) return undefined;
    if (!isComponentInstance(node)) return blockPropOf(node, target.propPath);
    target = nestedTargetOf(node, target.propPath, definitions);
  }
  return undefined;
}

/**
 * The schema of the component block's prop a setting fills, named as the
 * setting, where a field can fill it: read from the block's own declaration,
 * the prop the composed binding lands on.
 */
function bindableSchemaOf(
  property: Exposure,
  definition: ComponentDocument | undefined,
  definitions: ComponentLookup
): PropSchema | undefined {
  if (!BINDABLE_SETTING_TYPES.has(property.type)) return undefined;
  if (definition === undefined) return undefined;
  const schema = declaredPropOf(
    { definition, nodeId: property.nodeId, propPath: property.propPath },
    definitions
  );
  if (schema === undefined || bindablePropKind(schema) === undefined) {
    return undefined;
  }
  return { ...schema, label: labelOf(property) };
}

/**
 * The placement's stored binding of one setting, where composing applies it:
 * a record, and a list item binding only where it names its list.
 */
function storedBindingOf(node: BlockNode, id: string): Binding | undefined {
  const bindings = node.bindings;
  if (!isPlainRecord(bindings)) return undefined;
  const key = settingBindingKey(id);
  const binding = Object.hasOwn(bindings, key) ? bindings[key] : undefined;
  return isPlainRecord(binding) && keepsItsListWhenMoved(binding)
    ? binding
    : undefined;
}

/**
 * The rows with what a binding decides: a bound setting fills its prop
 * whatever another setting aimed at that prop holds, the last declared where
 * two are bound, as composing writes them. So the bound row is what the page
 * shows, and every other row aimed at its prop is shadowed by it.
 */
function withBoundTargets(
  rows: readonly ExposedRow[],
  properties: readonly { readonly property: Exposure }[]
): ExposedRow[] {
  const targetOf = (index: number): string => {
    const property = properties[index]?.property;
    return property === undefined
      ? ""
      : `${property.nodeId}\u0000${property.propPath}`;
  };
  const bound = new Map<string, ExposedRow>();
  rows.forEach((row, index) => {
    if (row.binding !== undefined) bound.set(targetOf(index), row);
  });
  return rows.map((row, index) => {
    const winner = bound.get(targetOf(index));
    if (winner === undefined) return row;
    if (winner === row) {
      const { shadowedBy: _shown, ...rest } = row;
      return rest;
    }
    return { ...row, shadowedBy: { id: winner.id, label: winner.label } };
  });
}

/** The resolver's rows, as the panel draws them. */
function rowsOf(
  properties: ReturnType<typeof instanceExposure>["properties"],
  node: BlockNode,
  definition: ComponentDocument | undefined,
  definitions: ComponentLookup
): ExposedRow[] {
  const labels = new Map(
    properties.map(
      state => [state.property.id, labelOf(state.property)] as const
    )
  );
  // Read off the node's own record rather than the resolver's source, which
  // is the target's and is shared by every exposure aimed at it.
  const stored = storedOverrides(node);
  const rows = properties.map(state => ({
    id: state.property.id,
    label: labelOf(state.property),
    type: state.property.type,
    value: state.value,
    source: state.source,
    cleared: state.cleared,
    ownOverride: Object.hasOwn(stored, state.property.id),
    supported: (EDITABLE_EXPOSED_TYPES as readonly string[]).includes(
      state.property.type
    ),
    options: optionsOf(state.property.options),
    ...bindingOf(state.property, node, definition, definitions),
    ...(state.shadowedBy === undefined
      ? {}
      : {
          shadowedBy: {
            id: state.shadowedBy,
            label: labels.get(state.shadowedBy) ?? state.shadowedBy,
          },
        }),
  }));
  return withBoundTargets(rows, properties);
}

/** A row's binding fields: its bindable schema and stored binding, if any. */
function bindingOf(
  property: Exposure,
  node: BlockNode,
  definition: ComponentDocument | undefined,
  definitions: ComponentLookup
): Pick<ExposedRow, "bindable" | "binding"> {
  const bindable = bindableSchemaOf(property, definition, definitions);
  if (bindable === undefined) return {};
  const binding = storedBindingOf(node, property.id);
  return binding === undefined ? { bindable } : { bindable, binding };
}

/**
 * What to call an exposed property: its label, or its id when the stored
 * label is not a string.
 *
 * The resolver checks the fields its own writer reads — id, node, path and
 * type — so a label reaches here as the stored or hook-shaped definition left
 * it, and one that is an object would be handed to the panel to draw as text.
 * The id is the one name the property is sure to have.
 */
function labelOf(property: { id: string; label?: unknown }): string {
  const label: unknown = property.label;
  return typeof label === "string" && label !== "" ? label : property.id;
}

/**
 * The choices a select exposure offers, as a control can draw them.
 *
 * Normalised here, where they are consumed, for the reason {@link labelOf}
 * gives: a value that is not a list offers nothing, an entry without a string
 * value and a string label is left out, and a value offered twice is offered
 * once — the control keys its items by value, and two items with one value
 * are one choice drawn twice.
 */
function optionsOf(options: unknown): ExposedRow["options"] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const usable: { value: string; label: string }[] = [];
  for (const entry of options as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { value, label } = entry as { value?: unknown; label?: unknown };
    if (typeof value !== "string" || typeof label !== "string") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    usable.push({ value, label });
  }
  return usable;
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
  const overrides = instanceProps(node).overrides;
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
  const { overrides: _stored, ...rest } = instanceProps(node);
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
 * An edit of a placement's bindings with each list item binding naming the
 * list it reads: the nearest list around the placement where it names none.
 * Composing moves a placement's binding onto the component's block, which
 * may sit in a list of the component's own, so a binding naming no list
 * would read that list there; the save refuses one, and composing skips it.
 * Any other op is handed back as it is.
 */
export function withPlacementLists(
  document: BlockDocument,
  op: BuilderOp
): BuilderOp {
  if (op.kind !== "update" || !isPlainRecord(op.patch.bindings)) return op;
  const node = findNode(document.nodes, op.id);
  if (node === undefined || !isComponentInstance(node)) return op;
  const nearest = outerListOf(document.nodes, op.id)?.id;
  if (nearest === undefined) return op;
  const bindings = Object.fromEntries(
    Object.entries(op.patch.bindings).map(([key, binding]) => [
      key,
      binding.source === "item" && !("list" in binding && binding.list)
        ? { ...binding, list: nearest }
        : binding,
    ])
  );
  return { ...op, patch: { ...op.patch, bindings } };
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
