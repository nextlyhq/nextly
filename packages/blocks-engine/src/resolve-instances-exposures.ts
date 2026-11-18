/**
 * What an instance changes about its definition's nodes: the overrides and
 * exposures planned per node, an instance's exposure state and variant
 * preview, and writing an override into a node's props.
 *
 * @module resolve-instances-exposures
 */
import {
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  type ComponentDocument,
  type ExposedProperty,
  isUnsetOverride,
  type OverrideValue,
} from "./document";
import { walkForest } from "./forest-walk";
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import {
  MAX_PROP_PATH_SEGMENTS,
  type PropExposure,
  type ResolvedBlockNode,
} from "./resolve-instances-contract";
import type { RetiredExposures } from "./retired-exposures";
import { boundedOwnKeys, defineEntry, ownEntry } from "./safe-record";
import {
  followerFills,
  type FollowerFill,
  type FollowerLimits,
} from "./setting-bindings";
import { isConditionGated } from "./visibility";

// ---------------------------------------------------------------------------
// What an instance changes about the definition's nodes
// ---------------------------------------------------------------------------

/** One override, resolved to the node prop it writes. */
interface PropEdit {
  path: string;
  value: OverrideValue;
  /** Clear the prop rather than replace it. */
  unset: boolean;
  /**
   * The segments written, where they are not `path` split at its dots: a
   * placement's setting, `overrides` and its whole id.
   */
  segments?: readonly string[];
}

/**
 * The edit a follower's fill writes: its value at its prop, and on a
 * placement following into one of its own settings, at that setting's whole
 * id, which is how composition reads it. The one way both the placed and the
 * shown-alone fill write it.
 *
 * A cleared setting clears a block's prop, and a placement's setting is
 * cleared by its `$unset` override: removing the override would give it the
 * placed component's default instead, which is not what the setting shows.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function followerEdit(fill: FollowerFill): PropEdit {
  const id = fill.placement ? boundSettingId(fill.prop) : undefined;
  if (id === undefined) {
    return { path: fill.prop, value: fill.value, unset: fill.unset };
  }
  return {
    path: fill.prop,
    value: fill.unset ? { $unset: true } : fill.value,
    unset: false,
    segments: ["overrides", id],
  };
}

/** Everything one instance changes about one node of the definition. */
export interface NodePlan {
  props: PropEdit[];
  /** `false` drops the node; `true` serves it unconditionally; absent leaves it alone. */
  visible?: boolean;
  /** Instance content, keyed by the slot NAME on this node. */
  slots?: Map<string, PlannedSlot>;
  /** Prop path to the host placement's exposure that feeds it, in editor mode. */
  exposedProps?: Record<string, PropExposure>;
  /**
   * Prop path to the binding the placement gave the setting that fills it,
   * written over the node's own binding of that prop.
   */
  bindings?: Record<string, unknown>;
  /**
   * Prop path to the placement's binding key that fills it, so a binding
   * the page gave is still known as the page's inside a nested component.
   */
  bindingKeys?: Record<string, string>;
  /**
   * Prop path to a binding of the component's own that fills it: a block
   * following a setting shows the setting's block's own binding, read where
   * the node's own bindings are, as a binding of this definition.
   */
  ownBindings?: Record<string, unknown>;
}

/**
 * Content bound for one slot, and whether it has been composed yet.
 *
 * The flag exists because two different things arrive here. The PAGE's own
 * slot content is stored and has to be composed in the host's scope — and is
 * composed only if the node it is bound for survives, since a gated or
 * overridden-away target discards it and composing it first records the
 * components inside it as read and as unresolvable, for content no reader
 * receives. A NESTED instance's content arrives already composed in its
 * component's scope, and composing it again would re-mint every id in it.
 */
export interface PlannedSlot {
  nodes: ResolvedBlockNode[];
  composed: boolean;
}

/** What each of the definition's nodes gets, keyed by its id in the definition. */
export function planEdits(
  definition: ComponentDocument,
  instance: ResolvedBlockNode,
  supplied: Record<string, ResolvedBlockNode[]> | undefined,
  composed: boolean,
  /**
   * The limits the definition is read under, for its followers, with the
   * caller's work allowance its follower walks are charged to.
   */
  limits?: FollowerLimits
): Map<string, NodePlan> {
  const plans = new Map<string, NodePlan>();
  const values = effectiveOverrides(definition, instance);
  if (values.size > 0) planExposed(definition.exposed, values, plans);
  planBoundSettings(definition.exposed, instance.bindings, plans);
  // After both: a block following a setting shows what the setting's own
  // block ends up with.
  planFollowers(definition, plans, limits);
  if (supplied !== undefined) {
    planSlots(definition.slots, supplied, plans, composed);
  }
  return plans;
}

/**
 * Record, on each planned node, which exposure feeds each of its props.
 *
 * One exposure per prop: where two point at the same prop, the one the page
 * shows is the last declared that the placement or its variant sets, else the
 * last declared, which is the order the writes apply in. An edit through any
 * other would change a value nobody sees. A visibility exposure is mapped
 * under `visibility`, with its type, so an editor can find the node it shows
 * or hides.
 */
export function planExposedProps(
  definition: ComponentDocument,
  instance: ResolvedBlockNode,
  plans: Map<string, NodePlan>,
  /** For a nested instance: its exposure ids to the host's that drive them. */
  relay?: ReadonlyMap<string, PropExposure>
): void {
  const set = effectiveOverrides(definition, instance);
  const chosen = new Map<string, { fed: PropExposure; set: boolean }>();
  for (const property of usableExposures(definition.exposed)) {
    const fed = fedBy(property, relay);
    if (fed === undefined) continue;
    // A visibility exposure drives the node, not a prop, so it is keyed by
    // the node's own `visibility` whatever its stored path says.
    const path =
      property.type === "visibility" ? "visibility" : property.propPath;
    if (property.nodeId === "" || !isUsablePropPath(path)) continue;
    const key = `${property.nodeId}\u0000${path}`;
    const isSet = set.has(property.id);
    const held = chosen.get(key);
    if (held !== undefined && held.set && !isSet) continue;
    chosen.set(key, { fed, set: isSet });
  }
  takeBoundTargets(chosen, boundWinnersOf(definition, instance), relay);
  for (const [key, { fed }] of chosen) {
    const [nodeId = "", path = ""] = key.split("\u0000");
    const plan = planFor(plans, nodeId);
    plan.exposedProps = { ...plan.exposedProps, [path]: fed };
  }
}

/**
 * The exposure that feeds an edit of `property`: its own, or for a nested
 * instance the host's that drives it, or none where no host exposure does.
 */
function fedBy(
  property: ExposedProperty,
  relay: ReadonlyMap<string, PropExposure> | undefined
): PropExposure | undefined {
  return relay === undefined
    ? { id: property.id, type: property.type }
    : relay.get(property.id);
}

/**
 * Give each target a bound setting fills to that setting: it fills its prop
 * whatever another setting holds, so an edit there is an edit of the bound
 * one.
 */
function takeBoundTargets(
  chosen: Map<string, { fed: PropExposure; set: boolean }>,
  bound: ReadonlyMap<string, BoundWinner>,
  relay: ReadonlyMap<string, PropExposure> | undefined
): void {
  for (const [key, { property }] of bound) {
    const fed = fedBy(property, relay);
    // A bound setting no host setting drives fills a prop no host edit can
    // change, so the prop is mapped to none.
    if (fed === undefined) chosen.delete(key);
    else chosen.set(key, { fed, set: true });
  }
}

/**
 * A nested instance's exposures that a host exposure drives, from the map the
 * host planned on that instance's node: a host exposure aimed at the nested
 * placement's `overrides.<id>` sets that exposure of the nested component, so
 * an edit to what it shows is an edit to the host exposure. `undefined` when
 * none is driven, which leaves the nested component's nodes unmapped.
 */
export function relayOf(
  fed: Readonly<Record<string, PropExposure>> | undefined
): ReadonlyMap<string, PropExposure> | undefined {
  if (fed === undefined) return undefined;
  const relay = new Map<string, PropExposure>();
  for (const path of Object.keys(fed)) {
    // One segment only: a host value is written along the path, so a dotted
    // id would get a value in the wrong place, and the canvas would offer an
    // edit that doesn't show. A binding goes by the whole key instead.
    const [head, inner, ...rest] = path.split(".");
    if (head !== "overrides" || inner === undefined || rest.length > 0) {
      continue;
    }
    const host = fed[path];
    if (host !== undefined) relay.set(inner, host);
  }
  return relay.size === 0 ? undefined : relay;
}

/**
 * Which layer supplied an exposed property's current value.
 *
 * Three layers, because an author editing an instance is answering a different
 * question in each: `definition` is what the component itself designed,
 * `variant` is a preset the definition offers, and `instance` is this author's
 * own answer. A panel that showed only "changed / unchanged" would report a
 * variant's preset as the author's own edit, and offer to reset something they
 * never set.
 */
export type OverriddenBy = "variant" | "instance";

/** An override's value together with the layer that supplied it. */
interface SourcedOverride {
  value: OverrideValue;
  source: OverriddenBy;
}

/** Where an exposed property's current value comes from. */
export type ExposedValueSource = "definition" | OverriddenBy;

/** One exposed property as an editor has to draw it. */
export interface ExposedPropertyState {
  /** The definition's own declaration, carried so a caller need not re-find it. */
  readonly property: ExposedProperty;
  /** Which layer supplied {@link value}. */
  readonly source: ExposedValueSource;
  /**
   * The value in force, already resolved through definition, variant and
   * instance in that order.
   *
   * `undefined` when the property is cleared, and also when the definition
   * simply holds nothing there — {@link cleared} is what separates them, and a
   * caller that reads only this cannot tell an author's deliberate blank from
   * an empty definition.
   */
  readonly value: OverrideValue;
  /** True when the value in force is the `$unset` sentinel rather than a value. */
  readonly cleared: boolean;
  /**
   * The exposure actually in force at this target, when it is not this one.
   *
   * Two exposures may carry different ids and point at the SAME node and path,
   * which a definition is free to declare. The resolver applies them in
   * declaration order onto one prop, so at most one is what the page shows.
   *
   * Both directions matter, which is why this is not "the later one". Where two
   * rows are overridden, the LAST write is in force and the earlier row's value
   * is stale. Where only one is overridden, that write is in force and the
   * OTHER row — inheriting, and reporting the definition's own value — is the
   * stale one. A panel drawing either as live shows a value the page does not
   * render.
   */
  readonly shadowedBy?: string;
}

/** What an instance may edit, and what it has stored that no longer applies. */
export interface InstanceExposure {
  /** In the definition's own declared order, which is the order it designed. */
  readonly properties: readonly ExposedPropertyState[];
  /**
   * Override ids the definition no longer exposes.
   *
   * Surfaced rather than dropped. A definition that stops exposing a property
   * leaves every instance holding a value for it, and silently discarding
   * those makes an author's work disappear at the moment somebody else edits
   * the component — so the editor is told, and can say so.
   *
   * A RETIRED id is not among them. A designer removed that field, was told
   * how much content it held, and confirmed it: its values are being taken
   * out of every page, so showing one as recoverable would offer the author
   * work that the next save strips.
   */
  readonly orphanedOverrideIds: readonly string[];
}

/**
 * What one instance of a definition currently shows for each exposed property.
 *
 * Derived from the RESOLVER's own result rather than computed beside it. The
 * overrides in force are applied to the definition's props with the same
 * writer the renderer uses, in the same order, and every row's value is then
 * READ BACK from what that produced. Any way two exposures can interact on one
 * node — the same path, a path inside another's, a parent written over a child
 * — is therefore answered by the write itself, not by a list of cases here
 * that would be complete only until the next shape nobody enumerated.
 */
export function instanceExposure(
  definition: ComponentDocument,
  instance: BlockNode,
  retired?: RetiredExposures
): InstanceExposure {
  const overrides = effectiveOverrides(definition, instance);
  const declared = usableExposures(definition.exposed);
  const nodes = nodeIndex(definition.nodes);
  const applied = appliedWrites(declared, overrides);
  const props = finalProps(nodes, applied);
  const byNode = writesByNode(applied);

  const bound = boundWinnersOf(definition, instance);
  const properties = declared.map(property =>
    withBoundWinner(
      exposedState(
        property,
        lastWriteOver(property, byNode.get(property.nodeId) ?? []),
        props,
        nodes
      ),
      bound
    )
  );

  const exposedIds = new Set(declared.map(property => property.id));
  const retiredIds = new Set(retired?.properties);
  const orphanedOverrideIds = [...overrides.keys()].filter(
    id => !exposedIds.has(id) && !retiredIds.has(id)
  );

  return { properties, orphanedOverrideIds };
}

/**
 * A row as a binding decides it: a setting whose binding fills its target
 * is what the page shows there, and every other setting aimed at that
 * target is shadowed by it, whatever either holds.
 */
function withBoundWinner(
  state: ExposedPropertyState,
  bound: ReadonlyMap<string, BoundWinner>
): ExposedPropertyState {
  if (state.property.type === "visibility") return state;
  const winner = bound.get(targetKey(state.property))?.property.id;
  if (winner === undefined) return state;
  const { shadowedBy: _literal, ...rest } = state;
  return winner === state.property.id ? rest : { ...rest, shadowedBy: winner };
}

/**
 * A component's own tree as one of its variants draws it: the variant's
 * values written onto the definition's nodes, and the nodes it hides dropped,
 * with every node keeping its id. For an editor previewing the variant open
 * in the component's own view, where the canvas selects and edits by id, so
 * the placement's scoped copy the resolver composes cannot stand in.
 *
 * Derived from the resolver's own pieces, as {@link instanceExposure} is: the
 * overrides a placement choosing the variant puts in force, written with the
 * same writer in the same order, and the same visibility decision. A variant
 * the component does not define, or one setting nothing in force, answers the
 * component itself.
 *
 * @experimental Settles when the component editor ships.
 */
export function variantPreview(
  definition: ComponentDocument,
  variant: string
): ComponentDocument {
  const chooser: BlockNode = {
    id: "",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { variant },
  };
  const overrides = effectiveOverrides(definition, chooser);
  const applied = appliedWrites(usableExposures(definition.exposed), overrides);
  if (applied.length === 0) return definition;
  const props = finalProps(nodeIndex(definition.nodes), applied);
  // The last in-force decision per node, as the plan for that node keeps it.
  const visible = new Map<string, boolean>();
  for (const { property, override } of applied) {
    if (property.type !== "visibility") continue;
    const decided = visibilityDecision(override.value);
    if (decided !== undefined) visible.set(property.nodeId, decided);
  }
  return {
    ...definition,
    nodes: previewForest(definition.nodes, props, visible),
  };
}

/** One forest of the preview: written props, hidden nodes dropped, ids kept. */
function previewForest(
  nodes: readonly BlockNode[],
  props: ReadonlyMap<string, Record<string, unknown>>,
  visible: ReadonlyMap<string, boolean>
): BlockNode[] {
  return nodes.flatMap(node => {
    const shown = visible.get(node.id);
    if (shown === false) return [];
    const copy: BlockNode = { ...node };
    const written = props.get(node.id);
    if (written !== undefined) copy.props = written;
    // Shown on purpose lifts the node's own gate, as the resolver does.
    if (shown === true) delete copy.visibility;
    if (node.slots !== undefined) {
      copy.slots = Object.fromEntries(
        Object.entries(node.slots).map(([name, inner]) => [
          name,
          previewForest(inner, props, visible),
        ])
      );
    }
    return [copy];
  });
}

/** One in-force override, together with the exposure that carries it. */
interface AppliedWrite {
  property: ExposedProperty;
  override: SourcedOverride;
}

/**
 * The overrides the resolver would actually apply, in declaration order.
 *
 * Only these are writes. A stored override the resolver ignores — a
 * non-boolean on a `visibility` exposure — is not a write, and letting it win
 * a collision over a valid earlier one would report the earlier row as
 * superseded by something that never touched the page.
 */
export function appliedWrites(
  declared: readonly ExposedProperty[],
  overrides: ReadonlyMap<string, SourcedOverride>
): readonly AppliedWrite[] {
  const applied: AppliedWrite[] = [];
  for (const property of declared) {
    const override = inForce(property, overrides.get(property.id));
    if (override !== undefined) applied.push({ property, override });
  }
  return applied;
}

/**
 * Each node's props with every in-force write applied, keyed by node id.
 *
 * Through {@link editedProps}, which is what the resolver itself applies a
 * plan with. Building the edits any other way would be a second
 * implementation of how a path lands on a record.
 */
export function finalProps(
  nodes: ReadonlyMap<string, BlockNode>,
  applied: readonly AppliedWrite[]
): ReadonlyMap<string, Record<string, unknown>> {
  const edits = new Map<string, PropEdit[]>();
  for (const { property, override } of applied) {
    if (property.type === "visibility") continue;
    const list = edits.get(property.nodeId) ?? [];
    list.push({
      path: property.propPath,
      value: override.value,
      unset: isUnsetOverride(override.value),
    });
    edits.set(property.nodeId, list);
  }

  const result = new Map<string, Record<string, unknown>>();
  for (const [nodeId, list] of edits) {
    const node = nodes.get(nodeId);
    if (node !== undefined) result.set(nodeId, editedProps(node.props, list));
  }
  return result;
}

/**
 * The in-force writes grouped by the node they land on, in declaration order.
 *
 * A write can only reach an exposure on the SAME node, so a row's winner is
 * found among its own node's writes rather than by scanning every write for
 * every row — which at the documented limit of a thousand exposures, all
 * overridden, was a million reach checks per inspector question. The cost is
 * now the sum over nodes of rows times writes there, which is linear when
 * exposures are spread across a definition and only approaches the old bound
 * when a thousand of them all point at one node.
 */
function writesByNode(
  applied: readonly AppliedWrite[]
): ReadonlyMap<string, readonly AppliedWrite[]> {
  const byNode = new Map<string, AppliedWrite[]>();
  for (const write of applied) {
    const list = byNode.get(write.property.nodeId) ?? [];
    list.push(write);
    byNode.set(write.property.nodeId, list);
  }
  return byNode;
}

/**
 * The last in-force write that reaches this exposure's target, if any.
 *
 * "Reaches" is the writer's notion, not string equality: on one node, a path
 * and any path inside it land on the same value — writing `a` replaces what
 * `a.b` sits in, and writing `a.b` changes what `a` holds — and every
 * `visibility` exposure on a node decides the same thing. The LAST such write
 * is what the page shows, and it may be this exposure's own.
 */
function lastWriteOver(
  property: ExposedProperty,
  applied: readonly AppliedWrite[]
): AppliedWrite | undefined {
  let last: AppliedWrite | undefined;
  for (const write of applied) {
    if (reachesSameTarget(property, write.property)) last = write;
  }
  return last;
}

/** True when a write to `b` changes the value `a` reads, or vice versa. */
function reachesSameTarget(a: ExposedProperty, b: ExposedProperty): boolean {
  if (a.nodeId !== b.nodeId) return false;
  if (a.type === "visibility" || b.type === "visibility") {
    return a.type === b.type;
  }
  return (
    isPathPrefix(a.propPath, b.propPath) || isPathPrefix(b.propPath, a.propPath)
  );
}

/** True when `shorter` names `longer` or one of its ancestors, segment-wise. */
function isPathPrefix(shorter: string, longer: string): boolean {
  return longer === shorter || longer.startsWith(`${shorter}.`);
}

/**
 * One row: what is in force at its target, and whether that was its own doing.
 *
 * The value is read from the final props for a prop exposure, so it reflects
 * every write that reached it. For a `visibility` exposure there is no prop to
 * read — the winning write's decision IS the value, and where there is no
 * write, the definition's own gate is ({@link inheritedVisibility}).
 */
function exposedState(
  property: ExposedProperty,
  winner: AppliedWrite | undefined,
  props: ReadonlyMap<string, Record<string, unknown>>,
  nodes: ReadonlyMap<string, BlockNode>
): ExposedPropertyState {
  const value = valueAt(property, winner, props, nodes);
  if (winner === undefined) {
    return { property, source: "definition", value, cleared: false };
  }
  const own = winner.property.id === property.id;
  // Cleared means the winning `$unset` ERASES this row's target — whichever
  // exposure wrote it. A clear at the row's own path or at an ancestor deletes
  // what the row reads (clearing `a` removes `a.b` with it), so the row is
  // cleared even when another exposure did the clearing; reporting it as
  // merely superseded would make a deliberate removal indistinguishable from
  // a definition that holds nothing. A clear BELOW the row is the one case
  // that does not erase it: `a.b` cleared leaves `a` holding whatever else it
  // had, so the ancestor reads what remains rather than being assumed gone.
  const cleared =
    isUnsetOverride(winner.override.value) &&
    erasesTarget(winner.property, property);
  return {
    property,
    source: winner.override.source,
    // Normalised to `undefined` when cleared, which the contract promises. For
    // a prop row the final props already read as absent; for a `visibility`
    // row the winning value IS the sentinel, and handing that object to a
    // caller expecting a blank would be the contract broken on exactly the
    // rows a clear is most likely to reach.
    value: cleared ? undefined : value,
    cleared,
    ...(own ? {} : { shadowedBy: winner.property.id }),
  };
}

/**
 * True when clearing `writer`'s target deletes what `row` reads.
 *
 * On one node, a `visibility` exposure erases every other visibility exposure
 * on it, and a prop path erases itself and everything beneath it. It does NOT
 * erase its ancestors, which is the asymmetry {@link reachesSameTarget} has no
 * reason to carry: reaching is symmetric, erasing is not.
 */
function erasesTarget(writer: ExposedProperty, row: ExposedProperty): boolean {
  if (writer.nodeId !== row.nodeId) return false;
  if (writer.type === "visibility" || row.type === "visibility") {
    return writer.type === row.type;
  }
  return isPathPrefix(writer.propPath, row.propPath);
}

/** The value a row shows: the final props at its path, or a visibility decision. */
function valueAt(
  property: ExposedProperty,
  winner: AppliedWrite | undefined,
  props: ReadonlyMap<string, Record<string, unknown>>,
  nodes: ReadonlyMap<string, BlockNode>
): OverrideValue {
  if (property.type === "visibility") {
    return winner === undefined
      ? inheritedVisibility(nodes.get(property.nodeId))
      : winner.override.value;
  }
  const record =
    props.get(property.nodeId) ?? nodes.get(property.nodeId)?.props;
  return readPath(record, property.propPath);
}

/**
 * What a `visibility` exposure reads when the instance has written nothing.
 *
 * The DEFINITION's own answer, which is `survivesGating` with no plan: a node
 * carrying entry-field conditions is not served, and one carrying none is.
 * Read from the target node rather than left blank, because blank is what a
 * consumer reads as "nothing decides this" — and something does. An inspector
 * drawing the row from a blank said "shown on this page" for a node the
 * resolver keeps gated and the renderer's hidden-node pass withholds, which
 * is the disagreement between the panel and the canvas that reading these
 * rows from the resolver exists to prevent.
 *
 * `false` rather than a third value, because it is the decision in force and
 * the row already says where it came from: `source` is `definition`, and
 * `ownOverride` is false, so a surface can tell an inherited gate from an
 * author's own hiding without a vocabulary of its own.
 *
 * An ungated node stays `undefined` — nothing is in force there, which is
 * what a row with no override on a node with no gate means, and the surfaces
 * already draw it as served.
 */
function inheritedVisibility(node: BlockNode | undefined): OverrideValue {
  if (node === undefined) return undefined;
  return isConditionGated(node) ? false : undefined;
}

/**
 * The stored override only if the RESOLVER would act on it.
 *
 * A `visibility` exposure decides whether the node is served, and the resolver
 * reads only booleans and the clear sentinel there — a string left behind when
 * an exposure changed type is ignored, and the definition's own visibility
 * stays in force. Reporting that stale value as the value in force would tell
 * an editor something the page does not render, which is the exact disagreement
 * deriving this from the resolver's precedence exists to prevent.
 */
function inForce(
  property: ExposedProperty,
  stored: SourcedOverride | undefined
): SourcedOverride | undefined {
  if (stored === undefined) return undefined;
  if (property.type === "visibility") {
    return visibilityDecision(stored.value) === undefined ? undefined : stored;
  }
  // The resolver refuses to write a path it cannot use — empty, doubled dots,
  // over the segment limit — and leaves the node untouched. Counting such an
  // override as in force would attribute a value to the instance that nothing
  // rendered, and let it win a collision over a write that did.
  return isUsablePropPath(property.propPath) ? stored : undefined;
}

/**
 * {@link nodeIndex} under a node budget, and whether the whole forest fit.
 *
 * The unbounded form is safe where the caller has already surveyed the forest
 * under a cap — `componentReachIn` returns before its variant pass for exactly
 * that reason. It is NOT safe for a definition handed straight in: a stored or
 * imported document can carry more nodes than any limit admits, and a caller
 * that resolves one placement per node would then walk that whole forest once
 * per placement, with the read cache hiding none of it.
 */
export function boundedNodeIndex(
  nodes: readonly BlockNode[],
  cap: number
): { index: ReadonlyMap<string, BlockNode>; complete: boolean } {
  const index = new Map<string, BlockNode>();
  let budget = cap;
  let truncated = false;
  walkForest(nodes, entry => {
    if (budget <= 0) {
      truncated = true;
      return "stop";
    }
    budget -= 1;
    // Persisted forests reach here unvalidated, so an entry may be `null` or a
    // primitive and reading `id` off one throws — the same guard `findNode`
    // carries, for the same reason.
    if (!isPlainRecord(entry.node)) return "skip";
    const id = entry.node.id;
    if (typeof id === "string" && !index.has(id)) {
      index.set(id, entry.node as unknown as BlockNode);
    }
    return "descend";
  });
  return { index, complete: !truncated };
}

/**
 * Every node in a forest by id, in one pass.
 *
 * Built once per question rather than searched per row. A definition near the
 * documented limits — a thousand exposures pointing into a forest of thousands
 * of nodes — would otherwise cost a full forest walk PER exposure, every time
 * an inspector asked, which is an editor stall scaling with the product of the
 * two rather than their sum.
 */
function nodeIndex(
  nodes: readonly BlockNode[]
): ReadonlyMap<string, BlockNode> {
  // DERIVED from the bounded form rather than walking the forest a second way.
  // Two indexers agree on the day they are written and drift after, and the
  // difference between them is only the budget.
  //
  // Unbounded is right for the two callers that reach here: `componentReachIn`
  // returns before its variant pass whenever its own capped survey truncated, so
  // a forest that arrives here has already fitted a bound; and
  // `instanceExposure` is handed a definition its caller has already read.
  return boundedNodeIndex(nodes, Number.POSITIVE_INFINITY).index;
}

/**
 * The exposures a caller can act on, from an array that may hold anything.
 *
 * A stored or imported definition reaches here unvalidated — `exposed` may be
 * an array containing `null`, or a record whose `propPath` is a number — and
 * the renderer tolerates both by skipping the member. An editor asking the same
 * document a question must not crash where the renderer draws the page, so
 * every field this code goes on to READ is checked here, under the same
 * envelope bound the resolver applies.
 */
export function usableExposures(exposed: unknown): readonly ExposedProperty[] {
  if (!Array.isArray(exposed)) return [];
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  const usable: ExposedProperty[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (isUsableExposure(entry)) usable.push(entry);
  }
  return usable;
}

/** True when every field the exposure view dereferences is the type it reads. */
function isUsableExposure(entry: unknown): entry is ExposedProperty {
  if (!isPlainRecord(entry)) return false;
  return (
    typeof entry.id === "string" &&
    typeof entry.nodeId === "string" &&
    typeof entry.propPath === "string" &&
    typeof entry.type === "string"
  );
}

/**
 * Read a dot path out of a props record.
 *
 * The exact inverse of {@link writeEdit}, and beside it on purpose: the two
 * halves of one grammar drift the moment they are written apart. `ownEntry`
 * throughout for the reason the writer uses it — the segments come from a
 * stored definition, and `props.constructor` reads a function off a record
 * that never had the key.
 */
function readPath(props: unknown, path: string): OverrideValue {
  if (!isUsablePropPath(path)) return undefined;
  let current: unknown = props;
  for (const segment of path.split(".")) {
    if (!isPlainRecord(current)) return undefined;
    current = ownEntry(current, segment);
  }
  return current;
}

/**
 * The variant's overrides with the instance's own written over them.
 *
 * That order, not the reverse: a variant is a preset the definition offers and
 * an instance's own value is the author's answer to it. Writing the preset last
 * would make selecting a variant silently discard edits already made.
 */
export function effectiveOverrides(
  definition: ComponentDocument,
  instance: BlockNode
): Map<string, SourcedOverride> {
  const values = new Map<string, SourcedOverride>();
  const props = isPlainRecord(instance.props) ? instance.props : {};
  collectOverrides(
    variantOverrides(definition, props.variant),
    values,
    "variant"
  );
  collectOverrides(props.overrides, values, "instance");
  return values;
}

/** The chosen variant's override record, if the definition offers it. */
function variantOverrides(
  definition: ComponentDocument,
  variant: unknown
): unknown {
  if (typeof variant !== "string" || variant === "") return undefined;
  const variants = definition.variants;
  if (!isPlainRecord(variants)) return undefined;
  const chosen = ownEntry(variants as Record<string, unknown>, variant);
  return isPlainRecord(chosen) ? chosen.overrides : undefined;
}

/** Fold one override record into the accumulator; later callers win. */
function collectOverrides(
  source: unknown,
  into: Map<string, SourcedOverride>,
  layer: OverriddenBy
): void {
  if (!isPlainRecord(source)) return;
  // Bounded during the walk, not after it. `Object.keys` on a record with a
  // hundred thousand keys allocates all of them before a budget checked in the
  // loop body gets a turn, so the cap would bound the work done PER key and
  // nothing at all about reaching them.
  const keys = boundedOwnKeys(source, MAX_ENVELOPE_ENTRIES);
  if (keys === null) return;
  for (const key of keys) {
    into.set(key, { value: ownEntry(source, key), source: layer });
  }
}

/** Turn overridden exposure ids into per-node edits. */
function planExposed(
  exposed: unknown,
  values: ReadonlyMap<string, SourcedOverride>,
  plans: Map<string, NodePlan>
): void {
  if (!Array.isArray(exposed)) return;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (!isPlainRecord(entry)) continue;
    const id = entry.id;
    const nodeId = entry.nodeId;
    if (typeof id !== "string" || !values.has(id)) continue;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    applyExposure(planFor(plans, nodeId), entry, values.get(id)?.value);
  }
}

/**
 * The prefix of the key a placement binds one of its settings under:
 * `overrides.<id>`, the path the setting's value is stored at in the
 * placement's props.
 */
const SETTING_BINDING_PREFIX = "overrides.";

/**
 * The key a placement binds the setting `id` under.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function settingBindingKey(id: string): string {
  return `${SETTING_BINDING_PREFIX}${id}`;
}

/**
 * The setting a placement's binding key names, or `undefined` for a key that
 * is not `overrides.<id>` with a non-empty id. The id is the rest of the key
 * as it is, dots included: a setting's id may hold one, and a placement's
 * keys name nothing but its settings.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function boundSettingId(key: string): string | undefined {
  if (!key.startsWith(SETTING_BINDING_PREFIX)) return undefined;
  const id = key.slice(SETTING_BINDING_PREFIX.length);
  return id === "" ? undefined : id;
}

/**
 * Whether a placement's binding reads what it read where the placement sits,
 * once it is moved onto the component's block: a list item binding names the
 * list it reads, since the block may sit in a list of the component's own,
 * which a binding naming none would read instead.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function keepsItsListWhenMoved(binding: unknown): boolean {
  if (!isPlainRecord(binding)) return false;
  if (binding.source !== "item") return true;
  return typeof binding.list === "string" && binding.list !== "";
}

/**
 * Turn a placement's bound settings into bindings of the props they fill.
 *
 * A placement binds a setting under `overrides.<id>`; the block that reads
 * the binding is the component's own, so the binding is written there, on
 * the prop the setting fills, where the page's binding pass reads it as it
 * reads any block's. A visibility setting decides whether a block is shown,
 * which no field fills, so it is never bound; nor is a setting the component
 * no longer has, nor a stored binding that is not a record.
 */
function planBoundSettings(
  exposed: unknown,
  bindings: unknown,
  plans: Map<string, NodePlan>
): void {
  const bound = boundSettings(bindings);
  for (const { property } of boundWinners(exposed, bound).values()) {
    const plan = planFor(plans, property.nodeId);
    plan.bindings = { ...plan.bindings };
    defineEntry(plan.bindings, property.propPath, bound.get(property.id));
    plan.bindingKeys = { ...plan.bindingKeys };
    defineEntry(
      plan.bindingKeys,
      property.propPath,
      settingBindingKey(property.id)
    );
  }
}

/**
 * Each block following a setting, given what its setting's block is: the
 * same value at its prop, and the binding over it, the placement's or else
 * the component's own.
 */
function planFollowers(
  definition: ComponentDocument,
  plans: Map<string, NodePlan>,
  limits: FollowerLimits | undefined
): void {
  const fills = followerFills(
    definition,
    (nodeId, path) => {
      const plan = plans.get(nodeId);
      const edit = plan?.props.filter(entry => entry.path === path).at(-1);
      const binding =
        plan?.bindings === undefined
          ? undefined
          : ownEntry(plan.bindings, path);
      const key =
        plan?.bindingKeys === undefined
          ? undefined
          : ownEntry(plan.bindingKeys, path);
      return {
        ...(edit === undefined
          ? {}
          : { edit: { value: edit.value, unset: edit.unset } }),
        ...(binding === undefined
          ? {}
          : { given: { binding, ...(key === undefined ? {} : { key }) } }),
      };
    },
    limits
  );
  for (const fill of fills) {
    const plan = planFor(plans, fill.nodeId);
    plan.props.push(followerEdit(fill));
    if (fill.given !== undefined) {
      plan.bindings = { ...plan.bindings };
      defineEntry(plan.bindings, fill.prop, fill.given.binding);
      if (fill.given.key !== undefined) {
        plan.bindingKeys = { ...plan.bindingKeys };
        defineEntry(plan.bindingKeys, fill.prop, fill.given.key);
      }
    } else if (fill.own !== undefined) {
      plan.ownBindings = { ...plan.ownBindings };
      defineEntry(plan.ownBindings, fill.prop, fill.own);
    }
  }
}

/** A bound setting, and the target it fills. */
interface BoundWinner {
  readonly property: ExposedProperty;
}

/**
 * Each target a placement's binding fills, by node and prop path, with the
 * setting whose binding fills it: the last declared where two bound settings
 * aim at one prop, as composing writes them in that order. A bound setting
 * fills its prop whatever another setting aimed there holds, so this is what
 * the page shows there, for the composed binding, the editor's exposure map
 * and the inspector's rows alike.
 */
function boundWinners(
  exposed: unknown,
  bound: ReadonlyMap<string, unknown>
): ReadonlyMap<string, BoundWinner> {
  const winners = new Map<string, BoundWinner>();
  if (bound.size === 0) return winners;
  for (const property of usableExposures(exposed)) {
    if (!bound.has(property.id) || !isBindableSetting(property)) continue;
    winners.set(targetKey(property), { property });
  }
  return winners;
}

/** A setting's target, as one key: its node and its prop path. */
function targetKey(property: ExposedProperty): string {
  return `${property.nodeId}\u0000${property.propPath}`;
}

/** The targets a placement's own bindings fill, with what fills each. */
function boundWinnersOf(
  definition: ComponentDocument,
  instance: BlockNode
): ReadonlyMap<string, BoundWinner> {
  return boundWinners(definition.exposed, boundSettings(instance.bindings));
}

/**
 * A placement's stored bindings, by the setting each binds: records only, and
 * a list item binding only where it names its list.
 */
function boundSettings(bindings: unknown): ReadonlyMap<string, unknown> {
  const bound = new Map<string, unknown>();
  if (!isPlainRecord(bindings)) return bound;
  const keys = boundedOwnKeys(bindings, MAX_ENVELOPE_ENTRIES) ?? [];
  for (const key of keys) {
    const id = boundSettingId(key);
    const binding = ownEntry(bindings, key);
    if (id !== undefined && keepsItsListWhenMoved(binding)) {
      bound.set(id, binding);
    }
  }
  return bound;
}

/**
 * Whether a setting's target can carry a binding: a prop of a block, at a
 * path the writer follows. A visibility setting decides whether the block is
 * shown, which no field fills.
 */
function isBindableSetting(property: ExposedProperty): boolean {
  return (
    property.type !== "visibility" &&
    property.nodeId !== "" &&
    isUsablePropPath(property.propPath)
  );
}

/** Write one exposure's override into the plan for its node. */
function applyExposure(
  plan: NodePlan,
  entry: Record<string, unknown>,
  value: OverrideValue
): void {
  if (entry.type === "visibility") {
    const decided = visibilityDecision(value);
    if (decided !== undefined) plan.visible = decided;
    return;
  }
  const path = entry.propPath;
  if (typeof path !== "string" || !isUsablePropPath(path)) return;
  plan.props.push({ path, value, unset: isUnsetOverride(value) });
}

/**
 * What a `visibility` override decides, or nothing.
 *
 * Booleans only. An override is a value an author's inspector wrote and a
 * `visibility` control writes `true` or `false`; coercing every other value
 * would let a stored `"false"` — or an image object left behind when an
 * exposure changed type — decide whether a region of the page is served.
 * Clearing it hides, because that is what "renders empty" means for a node.
 */
function visibilityDecision(value: OverrideValue): boolean | undefined {
  if (value === true) return true;
  if (value === false || isUnsetOverride(value)) return false;
  return undefined;
}

/** Route instance slot content to the definition node and slot it fills. */
function planSlots(
  slots: unknown,
  supplied: Record<string, ResolvedBlockNode[]>,
  plans: Map<string, NodePlan>,
  composed: boolean
): void {
  if (!isPlainRecord(slots)) return;
  const ids = boundedOwnKeys(slots, MAX_ENVELOPE_ENTRIES);
  if (ids === null) return;
  for (const id of ids) {
    const content = ownEntry(supplied, id);
    const target = slotTarget(ownEntry(slots, id));
    if (!Array.isArray(content) || target === undefined) continue;
    const plan = planFor(plans, target.nodeId);
    const into = plan.slots ?? new Map<string, PlannedSlot>();
    plan.slots = into;
    into.set(target.slot, { nodes: content, composed });
  }
}

/** The node and slot one exposed-slot declaration points at. */
function slotTarget(
  spec: unknown
): { nodeId: string; slot: string } | undefined {
  if (!isPlainRecord(spec)) return undefined;
  const { nodeId, slot } = spec;
  if (typeof nodeId !== "string" || nodeId === "") return undefined;
  if (typeof slot !== "string" || slot === "") return undefined;
  return { nodeId, slot };
}

/** The plan for one definition node, created on first use. */
function planFor(plans: Map<string, NodePlan>, nodeId: string): NodePlan {
  const existing = plans.get(nodeId);
  if (existing !== undefined) return existing;
  const created: NodePlan = { props: [] };
  plans.set(nodeId, created);
  return created;
}

// ---------------------------------------------------------------------------
// Writing an override into a node's props
// ---------------------------------------------------------------------------

/** A node's props with every planned edit applied, leaving the original alone. */
export function editedProps(
  props: unknown,
  edits: readonly PropEdit[]
): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainRecord(props)
    ? { ...props }
    : {};
  for (const edit of edits) writeEdit(next, edit);
  return next;
}

/**
 * Apply one edit at its dot path, copying each record on the way down.
 *
 * Copied rather than mutated because the definition is shared: two instances of
 * one component are handed the same stored object, and writing through it would
 * make the first instance's overrides appear inside the second.
 *
 * Written with `defineEntry`/`ownEntry` throughout. The path segments come from
 * a stored definition, and `props.__proto__ = value` sets a prototype instead
 * of a property while `props.constructor` reads a function from a record that
 * never had the key.
 */
function writeEdit(root: Record<string, unknown>, edit: PropEdit): void {
  const segments = edit.segments ?? edit.path.split(".");
  let target = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next = descend(target, segments[i], edit.unset);
    if (next === undefined) return;
    target = next;
  }
  const last = segments[segments.length - 1];
  if (!edit.unset) {
    defineEntry(target, last, edit.value);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(target, last)) delete target[last];
}

/**
 * The record one path segment leads to, copied so the original is untouched.
 *
 * `undefined` stops the write. Clearing a path that does not exist is already
 * cleared, and building the records to reach it would ADD the structure the
 * author asked to remove.
 */
function descend(
  target: Record<string, unknown>,
  key: string,
  unset: boolean
): Record<string, unknown> | undefined {
  const existing = ownEntry(target, key);
  if (isPlainRecord(existing)) {
    const copy = { ...existing };
    defineEntry(target, key, copy);
    return copy;
  }
  if (unset) return undefined;
  const created: Record<string, unknown> = {};
  defineEntry(target, key, created);
  return created;
}

/** Whether a stored `propPath` is one this will follow. */
function isUsablePropPath(path: string): boolean {
  if (path === "") return false;
  const segments = path.split(".");
  if (segments.length > MAX_PROP_PATH_SEGMENTS) return false;
  return segments.every(segment => segment !== "");
}
