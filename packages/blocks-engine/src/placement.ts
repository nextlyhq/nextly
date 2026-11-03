/**
 * The one placement rule: may this block go here?
 *
 * Every path that puts a block somewhere asks it — the Add panel, a canvas or
 * Layers drag, a keyboard move, paste, the op store, the server validator and
 * imports — so the editor cannot offer what the server refuses, and the server
 * cannot store what the editor would never have made. It combines:
 *
 * - the slot being one the parent DECLARES. A slot the parent never declares
 *   is one it never renders, so a block filed there is stored and invisible.
 *   A component placement declares the slots its component exposes;
 * - the child's declared `parent` and the slot's `allow` list (`nesting.ts`);
 *   for an exposed slot, both the exposure's list and the inner slot's;
 * - the HTML content model (`content-model.ts`): a phrasing-only parent takes
 *   phrasing children, and a kind an ancestor refuses anywhere beneath it —
 *   anything interactive inside a link — is refused at any depth.
 *
 * Everything is read from the node's TYPE and PROPS, so a block whose settings
 * change its HTML is judged by what it now renders.
 */
import {
  CONTENT_KINDS,
  contentModelKey,
  NO_MARKUP_CONTENT_MODEL,
  resolveContentModel,
  UNDECLARED_CONTENT_MODEL,
  type ContentKind,
  type ResolvedContentModel,
} from "./content-model";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
} from "./document";
import { MAX_ENVELOPE_ENTRIES, MAX_NODES } from "./limits";
import {
  canBeRoot,
  canNest,
  canNestInSlot,
  slotAdmits,
  type NestingRefusal,
  type NestingSource,
} from "./nesting";
import { isPlainRecord } from "./plain-record";
import {
  readableDefinition,
  resolveComponentInstances,
  type ComponentLookup,
} from "./resolve-instances";
import { boundedOwnKeys } from "./safe-record";
import type { SlotDefaultSource } from "./tree";
import { declaresNoMarkup } from "./visibility";

/**
 * What the rule reads its answers from.
 *
 * `nesting` answers the name rules (a child's parents, a slot's allow-list),
 * `definitions` the slots a block declares and its content model, and
 * `components` the slots a component placement exposes. A caller without
 * component definitions leaves `components` out, and a placement's slots are
 * then unknown rather than refused.
 */
export interface PlacementSources {
  readonly nesting: NestingSource;
  readonly definitions: SlotDefaultSource;
  readonly components?: ComponentLookup;
}

/** A node as the rule reads it. Stored data, so every field is checked. */
export interface PlacedNode {
  readonly id?: unknown;
  readonly type: string;
  readonly props?: unknown;
  readonly slots?: unknown;
}

/**
 * An ancestor that refuses a kind anywhere beneath it, named so a refusal can
 * say which block is in the way: "the linked Card around it".
 */
export interface ContentRefuser {
  readonly kind: ContentKind;
  readonly type: string;
  readonly id: string | undefined;
}

/** Why a placement is refused, beyond the name rules `nesting.ts` answers. */
export type PlacementRefusal =
  | NestingRefusal
  | "undeclared-slot"
  | "holds-no-blocks"
  | "phrasing-only"
  | "content-model";

/**
 * The rule's answer. A refusal names the block it is about, which for a
 * subtree is the descendant that broke the rule, not necessarily its root.
 */
export type PlacementVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: NestingRefusal;
      readonly blockType: string;
      /** The types the refusing rule permits; never empty. */
      readonly permitted: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly reason: "undeclared-slot" | "holds-no-blocks";
      readonly blockType: string;
      readonly parentType: string;
      readonly slot: string;
    }
  | {
      readonly allowed: false;
      readonly reason: "phrasing-only";
      readonly blockType: string;
      readonly parentType: string;
    }
  | {
      readonly allowed: false;
      readonly reason: "content-model";
      readonly blockType: string;
      /** The kind the block is that the ancestor refuses. */
      readonly kind: ContentKind;
      readonly refusedBy: ContentRefuser;
    };

/** A refusal, as the narrowed member of {@link PlacementVerdict}. */
export type PlacementRefused = Extract<PlacementVerdict, { allowed: false }>;

const ALLOWED: PlacementVerdict = { allowed: true };

/**
 * Where a block is being put: the top level, or a parent's named slot with
 * what the parent's ancestors refuse beneath them.
 */
export type PlacementSite =
  | { readonly kind: "root" }
  | {
      readonly kind: "slot";
      readonly parent: PlacedNode;
      readonly slot: string;
      /**
       * What reached the parent from its ancestors, nearest last. The
       * parent's own refusals and its slot's are added by the rule, so a
       * caller building a site for a top-level parent passes none.
       */
      readonly inherited: readonly ContentRefuser[];
    };

/**
 * One slot as the rule reads it: every allow-list that must admit a child
 * (an exposed slot carries the exposure's and the inner slot's), what its
 * direct children must be, and kinds refused beneath it beyond the parent's
 * own (an exposed slot inherits what the component's inner chain refuses).
 */
interface SlotRule {
  readonly allow: readonly (readonly string[])[];
  readonly content: "flow" | "phrasing";
  readonly without: readonly ContentRefuser[];
}

/**
 * Answers memoised for one judgement. A placement's slots and kinds are read
 * by composing it, and a drag asks about the same placement on every pointer
 * move. Keyed by the NODE, because its overrides and variant are part of what
 * it composes to.
 */
interface Memo {
  readonly instances: WeakMap<object, InstanceFacts | undefined>;
}

/** What one component placement declares, read from what it composes to. */
interface InstanceFacts {
  readonly slots: ReadonlyMap<string, SlotRule>;
  readonly kinds: readonly ContentKind[];
  /** The types of the blocks it draws at its top, which the name rules judge. */
  readonly rootTypes: readonly string[];
}

/** A fresh memo, for one judgement. */
function newMemo(): Memo {
  return { instances: new WeakMap() };
}

/**
 * A node's content model for its props.
 *
 * A block that draws nothing for these props is no content at all, decided by
 * its own `rendersNothing`. A component placement is what it composes to:
 * every kind its blocks are, phrasing only when every root is. Its slots are
 * judged per slot, so the placement itself refuses nothing beneath it here.
 */
function modelOf(
  node: PlacedNode,
  sources: PlacementSources,
  memo: Memo
): ResolvedContentModel {
  if (node.type === COMPONENT_INSTANCE_TYPE) {
    const facts = instanceFacts(node, sources, memo);
    return { is: facts?.kinds ?? ["flow"], content: "flow", without: [] };
  }
  const definition = sources.definitions.get(node.type);
  if (
    definition !== undefined &&
    declaresNoMarkup(node as unknown as BlockNode, type =>
      sources.definitions.get(type)
    )
  ) {
    return NO_MARKUP_CONTENT_MODEL;
  }
  return resolveContentModel(definition?.contentModel, node.props);
}

/** A node's content model as a comparable string. */
export function contentModelKeyOf(
  node: PlacedNode,
  sources: PlacementSources
): string {
  return contentModelKey(modelOf(node, sources, newMemo()));
}

/**
 * The slots a node declares, each with its rule, or undefined when they cannot
 * be known: a type no definition carries, or a component that cannot be read.
 * Unknown is not refused, for the reason `registryNestingSource` gives — the
 * missing registration is reported by the block-type lookup, and refusing the
 * placement too would describe it as a layout mistake.
 */
function declaredSlots(
  node: PlacedNode,
  model: ResolvedContentModel,
  sources: PlacementSources,
  memo: Memo
): ReadonlyMap<string, SlotRule> | undefined {
  if (node.type === COMPONENT_INSTANCE_TYPE) {
    return instanceFacts(node, sources, memo)?.slots;
  }
  const definition = sources.definitions.get(node.type);
  if (definition === undefined) return undefined;
  const rules = new Map<string, SlotRule>();
  for (const slot of Object.keys(definition.slots ?? {})) {
    const allow = sources.nesting.slotAllowOf?.(node.type, slot);
    rules.set(slot, {
      allow: Array.isArray(allow) && allow.length > 0 ? [allow] : [],
      content: model.content,
      without: [],
    });
  }
  return rules;
}

/**
 * The slot names a node declares, or undefined when they cannot be known.
 * What a keyboard move reads to pick the slot an indent enters.
 */
export function declaredSlotNames(
  node: PlacedNode,
  sources: PlacementSources
): readonly string[] | undefined {
  const memo = newMemo();
  const slots = declaredSlots(
    node,
    modelOf(node, sources, memo),
    sources,
    memo
  );
  return slots === undefined ? undefined : [...slots.keys()];
}

/**
 * What a component placement declares, read from what it COMPOSES to: the
 * resolver applies its variant and overrides and expands the components it
 * holds, so a placement whose override switches a Card's link on is judged as
 * the linked Card it draws. One implementation of "what does this placement
 * draw", the resolver's, rather than a second one here.
 */
function instanceFacts(
  node: PlacedNode,
  sources: PlacementSources,
  memo: Memo
): InstanceFacts | undefined {
  if (!isPlainRecord(node)) return undefined;
  if (memo.instances.has(node)) return memo.instances.get(node);
  // Recorded before composing, so a placement reaching itself reads as
  // unknown rather than recursing; the cycle is the resolver's to refuse.
  memo.instances.set(node, undefined);
  let facts: InstanceFacts | undefined;
  try {
    facts = composeInstance(node, sources, memo);
  } catch {
    // A lookup that raises is no answer, as when the engine places an instance.
    facts = undefined;
  }
  memo.instances.set(node, facts);
  return facts;
}

/** The type of the stand-in an exposed slot holds while a placement composes. */
const PROBE_TYPE = "nextly/placement-probe";

/** The stand-in's id for an exposed slot. */
const probeId = (slot: string): string => `nextly-placement-probe-${slot}`;

/** Where the walk of a composed placement is: what reached it, and its parent. */
interface ComposedVisit {
  readonly refused: readonly ContentRefuser[];
  readonly parent: Holder | undefined;
  readonly slot: string | undefined;
}

/** A composed node, with its model and what reached it. */
interface Holder {
  readonly node: PlacedNode;
  readonly model: ResolvedContentModel;
  readonly refused: readonly ContentRefuser[];
}

/**
 * Compose one placement with a stand-in in each exposed slot, then walk the
 * result once, bounded by the node cap. A stand-in lands where the host's
 * content for that slot would, so the node above it is the slot's holder and
 * the chain above that is what its content inherits.
 */
function composeInstance(
  node: PlacedNode & Readonly<Record<string, unknown>>,
  sources: PlacementSources,
  memo: Memo
): InstanceFacts | undefined {
  const components = sources.components;
  const exposed = exposedSlotsOf(node, components);
  if (components === undefined || exposed === undefined) return undefined;
  const probes = probesFor(exposed);
  if (probes === undefined) return undefined;
  const composed = resolveComponentInstances(
    {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [{ ...(node as unknown as BlockNode), slots: probes }],
    },
    components
  ).document.nodes;
  if (composed.some(root => root.unresolvedComponent !== undefined)) {
    return undefined;
  }
  return readComposed(composed, exposed, sources, memo);
}

/**
 * The slots a placement's component exposes, or undefined when its component
 * cannot be read.
 */
function exposedSlotsOf(
  node: PlacedNode,
  components: ComponentLookup | undefined
): Readonly<Record<string, unknown>> | undefined {
  const props = isPlainRecord(node.props) ? node.props : undefined;
  const componentId = props?.componentId;
  if (typeof componentId !== "string" || components === undefined) {
    return undefined;
  }
  const definition = readableDefinition(components.get(componentId));
  if (definition === undefined) return undefined;
  return isPlainRecord(definition.slots) ? definition.slots : {};
}

/**
 * One stand-in per exposed slot, read through the envelope bound as the
 * resolver reads it: a definition exposing more slots than that is malformed,
 * and its slots are unknown.
 */
function probesFor(
  exposed: Readonly<Record<string, unknown>>
): Record<string, BlockNode[]> | undefined {
  const slotIds = boundedOwnKeys(exposed, MAX_ENVELOPE_ENTRIES);
  if (slotIds === null) return undefined;
  const probes: Record<string, BlockNode[]> = {};
  for (const slot of slotIds) {
    probes[slot] = [
      { id: probeId(slot), type: PROBE_TYPE, version: 1, props: {} },
    ];
  }
  return probes;
}

/** Walk a composed placement: its kinds, and each exposed slot's rule. */
function readComposed(
  composed: readonly BlockNode[],
  exposed: Readonly<Record<string, unknown>>,
  sources: PlacementSources,
  memo: Memo
): InstanceFacts {
  const kinds = new Set<ContentKind>();
  const slots = new Map<string, SlotRule>();
  let rootsArePhrasing = composed.length > 0;
  const top: ComposedVisit = {
    refused: [],
    parent: undefined,
    slot: undefined,
  };
  walkPlaced(
    composed.slice(0, MAX_NODES).map(root => ({ node: root, carry: top })),
    (at, { refused, parent, slot }) => {
      if (at.type === PROBE_TYPE) {
        recordProbe(at, { parent, slot }, exposed, sources, slots);
        return undefined;
      }
      // A placement the resolver left standing (a cycle, a component too deep
      // or unreadable) draws a placeholder: read it as plain flow rather than
      // composing it again, which for a cycle would never end.
      const model = isUnresolved(at)
        ? UNDECLARED_CONTENT_MODEL
        : modelOf(at, sources, memo);
      if (parent === undefined) {
        // A root drawing nothing is neutral: only drawn roots decide.
        rootsArePhrasing &&=
          model.is.length === 0 || model.is.includes("phrasing");
      }
      // Phrasing is a fact about the roots, which are what sits in the host's
      // slot; every other kind counts from anywhere inside, for what an
      // ancestor refuses beneath it.
      for (const kind of model.is) if (kind !== "phrasing") kinds.add(kind);
      const holder: Holder = { node: at, model, refused };
      const beneath = withRefusals(refused, at, model);
      return childSlot => ({
        refused: beneath,
        parent: holder,
        slot: childSlot,
      });
    }
  );
  if (rootsArePhrasing) kinds.add("phrasing");
  return {
    slots,
    kinds: CONTENT_KINDS.filter(kind => kinds.has(kind)),
    rootTypes: composed
      .slice(0, MAX_NODES)
      .map(root => root.type)
      .filter(type => type !== PROBE_TYPE),
  };
}

/** Whether a composed node is a placement the resolver could not inline. */
function isUnresolved(node: PlacedNode): boolean {
  return (
    node.type === COMPONENT_INSTANCE_TYPE &&
    (node as { unresolvedComponent?: unknown }).unresolvedComponent !==
      undefined
  );
}

/** Record the rule of the exposed slot a stand-in landed in, by its holder. */
function recordProbe(
  probe: PlacedNode,
  at: { parent: Holder | undefined; slot: string | undefined },
  exposed: Readonly<Record<string, unknown>>,
  sources: PlacementSources,
  slots: Map<string, SlotRule>
): void {
  const exposureId = probeExposure(probe, exposed);
  if (
    exposureId === undefined ||
    at.parent === undefined ||
    at.slot === undefined
  ) {
    return;
  }
  slots.set(
    exposureId,
    slotRuleFor(exposed[exposureId], at.parent, at.slot, sources)
  );
}

/** Which exposed slot a stand-in stood in for, or undefined. */
function probeExposure(
  probe: PlacedNode,
  exposed: Readonly<Record<string, unknown>>
): string | undefined {
  return Object.keys(exposed).find(slot => probeId(slot) === probe.id);
}

/**
 * An exposed slot's rule: both allow-lists, the holder's content, and what the
 * chain down to the holder refuses.
 */
function slotRuleFor(
  exposure: unknown,
  holder: Holder,
  slot: string,
  sources: PlacementSources
): SlotRule {
  const allow = isPlainRecord(exposure) ? exposure.allow : undefined;
  const inner = sources.nesting.slotAllowOf?.(holder.node.type, slot);
  return {
    allow: [allow, inner].filter(
      (list): list is readonly string[] =>
        Array.isArray(list) && list.length > 0
    ),
    content: holder.model.content,
    without: withRefusals(holder.refused, holder.node, holder.model),
  };
}

/** Whether a stored value reads as a node the rule can judge. */
function isPlacedNode(value: unknown): value is PlacedNode {
  return isPlainRecord(value) && typeof value.type === "string";
}

/**
 * Breadth-first over nodes and their slot children, bounded by the node cap:
 * the one walk this module's questions share. `visit` answers what each slot's
 * children carry, nothing to stop descending, or `"stop"` to end the walk.
 */
function walkPlaced<T>(
  roots: readonly { node: unknown; carry: T }[],
  visit: (
    node: PlacedNode,
    carry: T
  ) => ((slot: string) => T) | "stop" | undefined
): void {
  const queue = roots.slice(0, MAX_NODES);
  for (let i = 0; i < queue.length && i < MAX_NODES; i++) {
    const { node, carry } = queue[i];
    if (!isPlacedNode(node)) continue;
    const beneath = visit(node, carry);
    if (beneath === "stop") return;
    if (beneath !== undefined) enqueueSlots(node, beneath, queue);
  }
}

/** Queue a node's slot children, each carrying what its slot hands down. */
function enqueueSlots<T>(
  node: PlacedNode,
  beneath: (slot: string) => T,
  queue: { node: unknown; carry: T }[]
): void {
  if (!isPlainRecord(node.slots)) return;
  for (const [slot, children] of Object.entries(node.slots)) {
    if (!Array.isArray(children)) continue;
    const carry = beneath(slot);
    for (const child of children) {
      if (queue.length >= MAX_NODES) return;
      queue.push({ node: child, carry });
    }
  }
}

/**
 * What a node's slot children inherit: what reached the node, plus what the
 * node itself refuses beneath it. A kind already refused keeps one entry,
 * naming the NEAREST refusing ancestor, which is the one a refusal should
 * point the author at.
 */
function withRefusals(
  inherited: readonly ContentRefuser[],
  node: PlacedNode,
  model: ResolvedContentModel
): readonly ContentRefuser[] {
  if (model.without.length === 0) return inherited;
  const id = typeof node.id === "string" ? node.id : undefined;
  const own = model.without.map(kind => ({ kind, type: node.type, id }));
  return [
    ...inherited.filter(entry => !model.without.includes(entry.kind)),
    ...own,
  ];
}

/** `extra` added to `inherited`, nearest wins, as {@link withRefusals}. */
function joinRefusals(
  inherited: readonly ContentRefuser[],
  extra: readonly ContentRefuser[]
): readonly ContentRefuser[] {
  if (extra.length === 0) return inherited;
  const kinds = new Set(extra.map(entry => entry.kind));
  return [...inherited.filter(entry => !kinds.has(entry.kind)), ...extra];
}

/**
 * Judge ONE node's direct placement at a site: not its descendants, which are
 * judged where they sit. The first refusal is the answer, in the order that
 * names the most actionable fact first: a slot that isn't there, then the
 * child's own parents, the slot's allow-lists, the parent's content, and
 * last what an ancestor refuses.
 */
function judgeOne(
  node: PlacedNode,
  model: ResolvedContentModel,
  site: PlacementSite,
  sources: PlacementSources,
  memo: Memo
): PlacementVerdict {
  const blockType = node.type;
  const named = namedTypesOf(node, sources, memo);
  if (site.kind === "root") return rootVerdict(named, sources);
  const { parent, slot } = site;
  const parentModel = modelOf(parent, sources, memo);
  const slots = declaredSlots(parent, parentModel, sources, memo);
  const rule = slots === undefined ? undefined : ownMapEntry(slots, slot);
  if (slots !== undefined && rule === undefined) {
    return {
      allowed: false,
      reason: slots.size === 0 ? "holds-no-blocks" : "undeclared-slot",
      blockType,
      parentType: parent.type,
      slot,
    };
  }
  const byName = firstRefusal(named, type =>
    nameRules(type, parent.type, slot, rule, sources)
  );
  if (!byName.allowed) return byName;
  return contentVerdict(blockType, model, {
    parent,
    parentModel,
    rule,
    inherited: site.inherited,
  });
}

/**
 * The content-model half of a placement: the parent's direct content, then
 * what any ancestor refuses beneath it. A block drawing nothing is no content,
 * so nothing it is can be refused.
 */
function contentVerdict(
  blockType: string,
  model: ResolvedContentModel,
  at: {
    parent: PlacedNode;
    parentModel: ResolvedContentModel;
    rule: SlotRule | undefined;
    inherited: readonly ContentRefuser[];
  }
): PlacementVerdict {
  const content = at.rule?.content ?? at.parentModel.content;
  if (
    content === "phrasing" &&
    model.is.length > 0 &&
    !model.is.includes("phrasing")
  ) {
    return {
      allowed: false,
      reason: "phrasing-only",
      blockType,
      parentType: at.parent.type,
    };
  }
  const beneath = joinRefusals(
    withRefusals(at.inherited, at.parent, at.parentModel),
    at.rule?.without ?? []
  );
  const refused = refusalFor(model, beneath);
  return refused === undefined
    ? ALLOWED
    : {
        allowed: false,
        reason: "content-model",
        blockType,
        kind: refused.kind,
        refusedBy: refused,
      };
}

/**
 * The types the name rules judge for a node: its own, or for a component
 * placement the blocks it draws at its top, since its own type restricts
 * nothing and it sits where those sit.
 */
function namedTypesOf(
  node: PlacedNode,
  sources: PlacementSources,
  memo: Memo
): readonly string[] {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return [node.type];
  return instanceFacts(node, sources, memo)?.rootTypes ?? [node.type];
}

/** The first refusal among these types, or allowed. */
function firstRefusal(
  types: readonly string[],
  judge: (type: string) => PlacementVerdict
): PlacementVerdict {
  for (const type of types) {
    const verdict = judge(type);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

/** Whether these types may stand at the top level. */
function rootVerdict(
  types: readonly string[],
  sources: PlacementSources
): PlacementVerdict {
  return firstRefusal(types, type => {
    const verdict = canBeRoot(type, sources.nesting);
    return verdict.allowed
      ? ALLOWED
      : {
          allowed: false,
          reason: verdict.reason,
          blockType: type,
          permitted: verdict.permitted,
        };
  });
}

/** A map entry looked up without trusting the key, as `ownEntry` does. */
function ownMapEntry<T>(
  map: ReadonlyMap<string, T>,
  key: string
): T | undefined {
  return map.has(key) ? map.get(key) : undefined;
}

/**
 * The name rules: the child's declared parents, then every allow-list the slot
 * carries. A registered parent's slot is asked of the nesting source, so a
 * caller's own source is honoured; an exposed slot's lists were read from the
 * component, and each must admit the child.
 */
function nameRules(
  blockType: string,
  parentType: string,
  slot: string,
  rule: SlotRule | undefined,
  sources: PlacementSources
): PlacementVerdict {
  const child = canNest(blockType, parentType, sources.nesting);
  if (!child.allowed) {
    return {
      allowed: false,
      reason: child.reason,
      blockType,
      permitted: child.permitted,
    };
  }
  if (parentType !== COMPONENT_INSTANCE_TYPE) {
    const verdict = canNestInSlot(blockType, parentType, slot, sources.nesting);
    return verdict.allowed
      ? ALLOWED
      : {
          allowed: false,
          reason: verdict.reason,
          blockType,
          permitted: verdict.permitted,
        };
  }
  for (const allow of rule?.allow ?? []) {
    if (!slotAdmits(allow, blockType)) {
      return {
        allowed: false,
        reason: "not-allowed-in-slot",
        blockType,
        permitted: allow,
      };
    }
  }
  return ALLOWED;
}

/** The nearest ancestor refusing a kind this block is, if any. */
function refusalFor(
  model: ResolvedContentModel,
  inherited: readonly ContentRefuser[]
): ContentRefuser | undefined {
  for (let i = inherited.length - 1; i >= 0; i--) {
    const entry = inherited[i];
    if (model.is.includes(entry.kind)) return entry;
  }
  return undefined;
}

/**
 * What reaches the children of `parent`'s `slot`, given what reached `parent`:
 * that, plus what the parent refuses beneath itself, plus what the slot adds
 * (an exposed slot carries its component's inner chain).
 */
function refusalsBeneath(
  parent: PlacedNode,
  parentModel: ResolvedContentModel,
  slot: string,
  reached: readonly ContentRefuser[],
  sources: PlacementSources,
  memo: Memo
): readonly ContentRefuser[] {
  const slots = declaredSlots(parent, parentModel, sources, memo);
  const rule = slots === undefined ? undefined : ownMapEntry(slots, slot);
  return joinRefusals(
    withRefusals(reached, parent, parentModel),
    rule?.without ?? []
  );
}

/**
 * Whether these blocks, with everything inside them, may go at a site.
 *
 * Judges every node of every placed subtree where it would sit, bounded by the
 * node cap, so moving a Box that holds a Button under a linked Card is refused
 * for the Button, and a subtree that already breaks the rule inside itself is
 * refused wherever it goes — a move is not a way to pass an old break off as
 * new ground.
 */
export function canPlace(
  placing: readonly PlacedNode[],
  site: PlacementSite,
  sources: PlacementSources
): PlacementVerdict {
  const memo = newMemo();
  let verdict: PlacementVerdict = ALLOWED;
  walkPlaced(
    placing.slice(0, MAX_NODES).map(node => ({ node, carry: site })),
    (node, at) => {
      const judged = judgeOne(
        node,
        modelOf(node, sources, memo),
        at,
        sources,
        memo
      );
      if (!judged.allowed) {
        verdict = judged;
        return "stop";
      }
      // What reached this node, which its children's sites carry; read once,
      // and only for a node that holds children.
      let reached: readonly ContentRefuser[] | undefined;
      return (slot): PlacementSite => ({
        kind: "slot",
        parent: node,
        slot,
        inherited: (reached ??= reachedAt(at, sources, memo)),
      });
    }
  );
  return verdict;
}

/** What reached a node placed at a site: nothing at the top level. */
function reachedAt(
  site: PlacementSite,
  sources: PlacementSources,
  memo: Memo
): readonly ContentRefuser[] {
  if (site.kind === "root") return [];
  return refusalsBeneath(
    site.parent,
    modelOf(site.parent, sources, memo),
    site.slot,
    site.inherited,
    sources,
    memo
  );
}

/** Where in a document a block is being put. */
export type PlacementPosition =
  | { readonly kind: "root" }
  | { readonly kind: "slot"; readonly parentId: string; readonly slot: string };

/**
 * The site a position names in a forest: its parent, and what the parent's
 * ancestors refuse beneath them. Undefined when the parent is not in the
 * forest, which a caller treats as no answer rather than as a refusal.
 */
export function placementSiteIn(
  nodes: readonly unknown[],
  position: PlacementPosition,
  sources: PlacementSources
): PlacementSite | undefined {
  if (position.kind === "root") return { kind: "root" };
  const chain = ancestryOf(nodes, position.parentId);
  if (chain === undefined) return undefined;
  const memo = newMemo();
  let reached: readonly ContentRefuser[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const node = chain[i].node;
    // Every step after the first was reached through a slot, by construction.
    const slot = chain[i + 1].slot;
    if (slot === undefined) return undefined;
    reached = refusalsBeneath(
      node,
      modelOf(node, sources, memo),
      slot,
      reached,
      sources,
      memo
    );
  }
  const parent = chain[chain.length - 1].node;
  return { kind: "slot", parent, slot: position.slot, inherited: reached };
}

/**
 * The chain from a top-level node down to the node with this id, each with
 * the slot it sits in (none for the first), or undefined when it is absent.
 * Breadth-first and bounded by the node cap.
 */
function ancestryOf(
  nodes: readonly unknown[],
  id: string
): readonly { node: PlacedNode; slot: string | undefined }[] | undefined {
  interface Step {
    readonly node: PlacedNode;
    readonly slot: string | undefined;
    readonly up: Step | undefined;
  }
  let found: Step | undefined;
  const top: Pick<Step, "slot" | "up"> = { slot: undefined, up: undefined };
  walkPlaced(
    nodes.slice(0, MAX_NODES).map(node => ({ node, carry: top })),
    (node, { slot, up }) => {
      const step: Step = { node, slot, up };
      if (node.id === id) {
        found = step;
        return "stop";
      }
      return childSlot => ({ slot: childSlot, up: step });
    }
  );
  const chain: { node: PlacedNode; slot: string | undefined }[] = [];
  for (let at = found; at !== undefined; at = at.up) {
    chain.unshift({ node: at.node, slot: at.slot });
  }
  return found === undefined ? undefined : chain;
}

/**
 * Whether blocks may go at a position in a forest: {@link canPlace} at the
 * site {@link placementSiteIn} finds. A position whose parent is absent is
 * allowed, because there is nothing there to judge against and the op layer
 * refuses a missing parent in its own words.
 */
export function canPlaceIn(
  nodes: readonly unknown[],
  placing: readonly PlacedNode[],
  position: PlacementPosition,
  sources: PlacementSources
): PlacementVerdict {
  const site = placementSiteIn(nodes, position, sources);
  return site === undefined ? ALLOWED : canPlace(placing, site, sources);
}

/**
 * One node of a whole-document walk, judged where it sits, with the signature
 * that says whether a stored document held the same break.
 */
export interface TrackedPlacement {
  readonly verdict: PlacementVerdict;
  /**
   * The node and its whole chain of ancestors: each one's id, type, content
   * model and the slot below it. Two documents holding a break with the same
   * signature hold it in the same place for the same reason, so a break whose
   * signature a stored form also has is OLD; converting a block in place,
   * changing a setting that changes what it is, or moving a subtree under
   * another ancestor all change it.
   */
  readonly signature: string;
}

/**
 * Judges a document node by node as a caller's walk reaches it, parents
 * before children. The walk is the caller's — the validator's bounded one —
 * so this keeps only what each node passes to its children.
 */
export interface PlacementTracker {
  /**
   * Judge `node`, reached in `parent`'s `slot` (both undefined at the top
   * level). Undefined when the node or its parent cannot be read, which the
   * validator reports in its own words.
   */
  visit(
    node: unknown,
    parent: unknown,
    slot: string | undefined
  ): TrackedPlacement | undefined;
}

/** A tracker for one walk of one document. */
export function placementTracker(sources: PlacementSources): PlacementTracker {
  const memo = newMemo();
  const seen = new Map<
    unknown,
    {
      model: ResolvedContentModel;
      reached: readonly ContentRefuser[];
      signature: string;
    }
  >();
  return {
    visit(node, parent, slot) {
      if (!isPlainRecord(node) || typeof node.type !== "string")
        return undefined;
      const placed = node as unknown as PlacedNode;
      const model = modelOf(placed, sources, memo);
      const own = `${typeof node.id === "string" ? node.id : "?"}:${node.type}:${contentModelKey(model)}`;
      if (parent === undefined || slot === undefined) {
        seen.set(node, { model, reached: [], signature: own });
        return {
          verdict: judgeOne(placed, model, { kind: "root" }, sources, memo),
          signature: own,
        };
      }
      const above = seen.get(parent);
      if (above === undefined || !isPlainRecord(parent)) return undefined;
      const parentNode = parent as unknown as PlacedNode;
      const site: PlacementSite = {
        kind: "slot",
        parent: parentNode,
        slot,
        inherited: above.reached,
      };
      const reached = refusalsBeneath(
        parentNode,
        above.model,
        slot,
        above.reached,
        sources,
        memo
      );
      const signature = `${above.signature}/${slot}>${own}`;
      seen.set(node, { model, reached, signature });
      return {
        verdict: judgeOne(placed, model, site, sources, memo),
        signature,
      };
    },
  };
}
