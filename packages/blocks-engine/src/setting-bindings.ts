/**
 * A block inside a component that follows one of the component's own
 * settings: `{ $bind: "<setting id>", source: "setting" }`.
 *
 * The binding lives on the block, so copying, deleting and duplicating the
 * block carry it as any binding is carried. Composed, the block shows what
 * the placement gives the setting: its value, else its binding, else the
 * setting's default, which is the value (and binding) on the setting's own
 * block. A component shown alone shows the default. Anywhere else, or once
 * its setting is gone, the binding is unbound and the block shows its own
 * value.
 *
 * @module setting-bindings
 */
import type { PropSchema } from "./block";
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BlockNode,
  type ExposedProperty,
} from "./document";
import { pointer } from "./issue-text";
import {
  DEFAULT_LIMITS,
  type DocumentLimits,
  MAX_ENVELOPE_ENTRIES,
} from "./limits";
import { drawsItsEntry } from "./list-query-contract";
import { isPlainRecord } from "./plain-record";
import { choicesFitProp, exposureTypeForProp } from "./prop-exposure";
import { defineEntry, ownEntry, ownKeys } from "./safe-record";
import type { ValidationIssue } from "./validation-contract";

/**
 * The nodes, and the levels of nesting, a follower is looked for under: a
 * document's own limits, so what a save accepts is what is filled, and a
 * stored chain past them is never walked.
 */
export type FollowerLimits = Pick<DocumentLimits, "maxNodes" | "maxDepth"> & {
  /**
   * The caller's work allowance, where one bounds the whole resolution: each
   * entry either walk reads is charged to it, and once it is spent neither
   * reads further, as the clone stops once it is.
   */
  readonly work?: { left: number };
};

/** Charge one entry read to the caller's allowance, or say it is spent. */
function spendWork(work: { left: number } | undefined): boolean {
  if (work === undefined) return true;
  if (work.left <= 0) return false;
  work.left -= 1;
  return true;
}

/** The source of a binding that follows one of its component's settings. */
const SETTING_BINDING_SOURCE = "setting";

/**
 * The setting a binding follows, or `undefined` for a binding that follows
 * none.
 *
 * @experimental Settles with the editor's binding controls.
 */
function followedSettingId(binding: unknown): string | undefined {
  if (!isPlainRecord(binding)) return undefined;
  if (ownEntry(binding, "source") !== SETTING_BINDING_SOURCE) return undefined;
  const id = ownEntry(binding, "$bind");
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * The settings of a component a block may follow, by id: each whose pointer
 * is readable and which holds a value, so not a visibility setting, which
 * decides whether its block is shown. The first of two sharing an id, as the
 * envelope check refuses the second.
 */
function followableSettings(
  exposed: unknown
): ReadonlyMap<string, ExposedProperty> {
  const settings = new Map<string, ExposedProperty>();
  if (!Array.isArray(exposed)) return settings;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (!isPlainRecord(entry)) continue;
    const { id, nodeId, propPath, type } = entry;
    if (typeof id !== "string" || settings.has(id)) continue;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    if (typeof propPath !== "string" || propPath === "") continue;
    if (type === "visibility") continue;
    settings.set(id, entry as unknown as ExposedProperty);
  }
  return settings;
}

/**
 * Whether `prop` of `node` is the value of a setting itself, which follows
 * nothing: it is what its followers show.
 */
function holdsSetting(
  settings: ReadonlyMap<string, ExposedProperty>,
  nodeId: string,
  prop: string
): boolean {
  for (const setting of settings.values()) {
    if (setting.nodeId === nodeId && setting.propPath === prop) return true;
  }
  return false;
}

/**
 * Each binding that follows a setting, with the block and prop it fills and
 * where it is stored, over at most `maxNodes` blocks.
 */
function eachFollower(
  nodes: unknown,
  path: string,
  visit: (node: BlockNode, prop: string, id: string, at: string) => void,
  /**
   * Nodes left to read, levels left to descend, and the caller's allowance:
   * past any of them, nothing is.
   */
  budget: { left: number; depth: number; work?: { left: number } }
): void {
  if (!Array.isArray(nodes) || budget.depth <= 0) return;
  budget.depth -= 1;
  for (let i = 0; i < nodes.length && budget.left > 0; i += 1) {
    // Charged for every entry read, a node or not, so a forest of entries
    // that are no nodes is read only as far as the budget, as one of nodes is.
    if (!spendWork(budget.work)) break;
    const node: unknown = nodes[i];
    budget.left -= 1;
    if (!isPlainRecord(node)) continue;
    const at = `${path}/${i}`;
    followersOn(node as unknown as BlockNode, at, visit);
    // A follower in a placement's slot content is this component's too.
    const slots = ownEntry(node, "slots");
    if (!isPlainRecord(slots)) continue;
    for (const name of ownKeys(slots)) {
      eachFollower(
        ownEntry(slots, name),
        pointer(`${at}/slots`, name),
        visit,
        budget
      );
    }
  }
  budget.depth += 1;
}

/** The bindings of one block that follow a setting. */
function followersOn(
  node: BlockNode,
  at: string,
  visit: (node: BlockNode, prop: string, id: string, at: string) => void
): void {
  const bindings: unknown = node.bindings;
  if (!isPlainRecord(bindings)) return;
  for (const prop of ownKeys(bindings)) {
    const id = followedSettingId(ownEntry(bindings, prop));
    if (id !== undefined) visit(node, prop, id, at);
  }
}

/**
 * Where a document's setting bindings may stand.
 *
 * In a component, each must follow a setting the component has and that
 * holds a value, and not from that setting's own block, which is what its
 * followers show: anything else is refused. Outside a component no setting
 * is there to follow, so it shows the block's own value, which is said as a
 * warning rather than refused: a block copied out of a component keeps it,
 * as a list item binding copied out of a list does.
 */
export function settingBindingIssues(
  doc: BlockDocument,
  limits: FollowerLimits = DEFAULT_LIMITS,
  /**
   * A block's prop's schema, where its block is known; a prop a setting of
   * another type would fill is refused, as is a select prop lacking one of a
   * select setting's choices. Unknown, it is not judged.
   */
  propSchemaOf?: (node: BlockNode, prop: string) => PropSchema | undefined
): ValidationIssue[] {
  if (!isPlainRecord(doc)) return [];
  const issues: ValidationIssue[] = [];
  const component = doc.kind === "component";
  const exposed = ownEntry(doc, "exposed");
  const settings = followableSettings(exposed);
  const named = namedSettings(exposed);
  eachFollower(
    ownEntry(doc, "nodes"),
    "/nodes",
    (node, prop, id, at) => {
      const path = pointer(`${at}/bindings`, prop);
      if (!component) {
        issues.push({
          path,
          code: "invalid-binding",
          severity: "warning",
          message: `This binding follows a component's setting "${id}", and this isn't a component, so the block shows its own value.`,
        });
        return;
      }
      const refusal = followerRefusal(node, prop, id, {
        settings,
        named,
        propSchemaOf,
      });
      if (refusal !== undefined) {
        issues.push({
          path,
          code: "invalid-binding",
          severity: "error",
          message: refusal,
        });
      }
    },
    { left: limits.maxNodes, depth: limits.maxDepth }
  );
  return issues;
}

/** Why a component's block may not follow setting `id` from `prop`, if it may not. */
function followerRefusal(
  node: BlockNode,
  prop: string,
  id: string,
  component: {
    readonly settings: ReadonlyMap<string, ExposedProperty>;
    readonly named: ReadonlySet<string>;
    readonly propSchemaOf:
      | ((node: BlockNode, prop: string) => PropSchema | undefined)
      | undefined;
  }
): string | undefined {
  const setting = component.settings.get(id);
  if (setting === undefined) {
    return component.named.has(id)
      ? `The setting "${id}" shows or hides its block, so a block can't follow it.`
      : `This binding follows the setting "${id}", which this component doesn't have.`;
  }
  if (holdsSetting(component.settings, node.id, prop)) {
    return `This is the value of a setting, which its followers show, so it can't follow the setting "${id}".`;
  }
  // Its value is copied into the prop, so it must be a value the prop holds.
  const schema = component.propSchemaOf?.(node, prop);
  const takes = exposureTypeForProp(schema);
  if (schema === undefined || takes === undefined) return undefined;
  if (takes !== setting.type) {
    return `The setting "${id}" holds ${setting.type}, and this prop holds ${takes}, so it can't follow it.`;
  }
  // A choice is copied as written, so one the prop lacks is one it can't draw.
  if (takes === "select" && !choicesFitProp(settingChoices(setting), schema)) {
    return `The setting "${id}" offers a choice this prop doesn't take, so it can't follow it.`;
  }
  return undefined;
}

/** The values a stored select setting offers, skipping any malformed choice. */
function settingChoices(setting: ExposedProperty): readonly string[] {
  const options: unknown = setting.options;
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options.slice(0, MAX_ENVELOPE_ENTRIES) as unknown[]) {
    if (isPlainRecord(option) && typeof option.value === "string") {
      values.push(option.value);
    }
  }
  return values;
}

/** Every setting id a component declares, whatever it holds. */
function namedSettings(exposed: unknown): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(exposed)) return ids;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (isPlainRecord(entry) && typeof entry.id === "string") ids.add(entry.id);
  }
  return ids;
}

/**
 * What a placement does to one setting's own block: the last edit it makes
 * to the setting's prop, and the binding it gives that prop, with the key it
 * gave it under.
 */
export interface SettingTarget {
  readonly edit?: { readonly value: unknown; readonly unset: boolean };
  readonly given?: { readonly binding: unknown; readonly key?: string };
}

/**
 * What one block following a setting shows: the setting's block's value at
 * its prop, and the binding over it, the placement's (`given`) or else the
 * setting's block's own (`own`). Neither, and the block shows the value.
 */
export interface FollowerFill {
  readonly nodeId: string;
  readonly prop: string;
  /**
   * Whether the follower is a placement, whose `overrides.<id>` key names a
   * setting of the component it places by its whole id, dots and all.
   */
  readonly placement: boolean;
  /** The setting it follows. */
  readonly settingId: string;
  readonly value: unknown;
  readonly unset: boolean;
  readonly given?: SettingTarget["given"];
  readonly own?: unknown;
}

/**
 * The fill of each block of a component definition that follows one of its
 * settings, given what a placement does to each setting's own block
 * (`targetOf`): a follower shows what that block shows, so one question,
 * the setting's block, answers both. A follower of a setting the component
 * lacks, or of its own prop, gets none and is left unbound.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function followerFills(
  definition: unknown,
  targetOf: (nodeId: string, path: string) => SettingTarget,
  limits: FollowerLimits = DEFAULT_LIMITS
): FollowerFill[] {
  if (!isPlainRecord(definition)) return [];
  const settings = followableSettings(ownEntry(definition, "exposed"));
  if (settings.size === 0) return [];
  const nodes = ownEntry(definition, "nodes");
  const followers: {
    readonly node: BlockNode;
    readonly prop: string;
    readonly id: string;
    readonly setting: ExposedProperty;
  }[] = [];
  eachFollower(
    nodes,
    "/nodes",
    (node, prop, id) => {
      const setting = settings.get(id);
      if (setting === undefined || holdsSetting(settings, node.id, prop)) {
        return;
      }
      followers.push({ node, prop, id, setting });
    },
    { left: limits.maxNodes, depth: limits.maxDepth, work: limits.work }
  );
  // Most components with settings have no follower, so the second walk,
  // which finds each setting's block, is taken only once one is found.
  if (followers.length === 0) return [];
  const index = nodesById(nodes, limits);
  const fills: FollowerFill[] = [];
  for (const { node, prop, id, setting } of followers) {
    const block = index.nodes.get(setting.nodeId);
    if (block === undefined) continue;
    const at = { block, list: index.listOf.get(block.id) };
    fills.push({
      ...fillFrom(node.id, prop, at, setting.propPath, targetOf),
      placement: node.type === COMPONENT_INSTANCE_TYPE,
      settingId: id,
    });
  }
  return fills;
}

/** One follower's fill, from the setting's block and what is done to it. */
function fillFrom(
  nodeId: string,
  prop: string,
  setting: { readonly block: BlockNode; readonly list: string | undefined },
  path: string,
  targetOf: (nodeId: string, path: string) => SettingTarget
): Omit<FollowerFill, "settingId" | "placement"> {
  const { block } = setting;
  const target = targetOf(block.id, path);
  const value =
    target.edit === undefined ? propAt(block.props, path) : target.edit.value;
  const unset =
    target.edit === undefined ? value === undefined : target.edit.unset;
  const own = withItsList(
    isPlainRecord(block.bindings) ? ownEntry(block.bindings, path) : undefined,
    setting.list
  );
  return {
    nodeId,
    prop,
    value,
    unset,
    ...(target.given === undefined ? {} : { given: target.given }),
    ...(target.given === undefined && own !== undefined ? { own } : {}),
  };
}

/**
 * A setting's block's own binding as its follower reads it: a list item
 * binding naming no list reads the list nearest the setting's block, which
 * a follower in another list would not, so that list is named.
 */
function withItsList(binding: unknown, list: string | undefined): unknown {
  if (!isPlainRecord(binding) || list === undefined) return binding;
  if (ownEntry(binding, "source") !== "item") return binding;
  if (ownEntry(binding, "list") !== undefined) return binding;
  return { ...binding, list };
}

/** The value at a dot path of a block's props. */
function propAt(props: unknown, path: string): unknown {
  let current: unknown = props;
  for (const segment of path.split(".")) {
    if (!isPlainRecord(current)) return undefined;
    current = ownEntry(current, segment);
  }
  return current;
}

/**
 * The blocks of a forest, slot content included, by id, with the Collection
 * list whose entry is the item where each sits, over at most `maxNodes`: a
 * list's per-entry slot starts its scope, and its empty state, drawn with no
 * entry, keeps the one around the list, as `outerListOf` answers.
 */
function nodesById(
  nodes: unknown,
  limits: FollowerLimits
): {
  nodes: Map<string, BlockNode>;
  listOf: Map<string, string | undefined>;
} {
  const found = {
    nodes: new Map<string, BlockNode>(),
    listOf: new Map<string, string | undefined>(),
  };
  const budget = { left: limits.maxNodes };
  const visit = (
    forest: unknown,
    list: string | undefined,
    depth: number
  ): void => {
    if (!Array.isArray(forest) || depth > limits.maxDepth) return;
    for (const node of forest as unknown[]) {
      if (budget.left <= 0) return;
      // Charged before the entry is judged, a node or not, as the follower
      // walk is, so entries that are no nodes don't read past the budget.
      if (!spendWork(limits.work)) return;
      budget.left -= 1;
      if (!indexed(node, list, found)) continue;
      for (const [name, children] of slotForests(node)) {
        visit(children, drawsItsEntry(node, name) ? node.id : list, depth + 1);
      }
    }
  };
  visit(nodes, undefined, 1);
  return found;
}

/**
 * One node into the index, first of an id kept, with the list whose entry is
 * its item; `false` for an entry that is no node.
 */
function indexed(
  node: unknown,
  list: string | undefined,
  found: {
    nodes: Map<string, BlockNode>;
    listOf: Map<string, string | undefined>;
  }
): node is BlockNode {
  if (!isPlainRecord(node) || typeof node.id !== "string") return false;
  if (!found.nodes.has(node.id)) {
    found.nodes.set(node.id, node as unknown as BlockNode);
    found.listOf.set(node.id, list);
  }
  return true;
}

/** The forests a node's slots hold, by slot name. */
function slotForests(node: unknown): [string, unknown][] {
  const slots = isPlainRecord(node) ? ownEntry(node, "slots") : undefined;
  return isPlainRecord(slots)
    ? ownKeys(slots).map(name => [name, ownEntry(slots, name)])
    : [];
}

/**
 * A node's bindings without those following a setting, `undefined` when
 * none is left: composed, each was filled from its setting or is unbound.
 */
export function withoutSettingBindings(bindings: unknown): unknown {
  if (!isPlainRecord(bindings)) return bindings;
  const keys = ownKeys(bindings);
  const kept = keys.filter(
    key => followedSettingId(ownEntry(bindings, key)) === undefined
  );
  if (kept.length === keys.length) return bindings;
  if (kept.length === 0) return undefined;
  const next: Record<string, unknown> = {};
  for (const key of kept) defineEntry(next, key, ownEntry(bindings, key));
  return next;
}
