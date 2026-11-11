/**
 * The Builder's outline as data: every field of an entity at every depth,
 * which of them a person may change, and which rows show given what is folded
 * and what is being looked for.
 *
 * Pure, so the outline component only draws what this decides, and the
 * settings panel asks the same read-only question the outline answers.
 *
 * @module lib/builder/outline/outline-model
 */
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "nextly/field-group-type";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import type { FieldDefinition } from "@admin/types/collection";

import type { FieldPlacement } from "../field-placement";
import { convertToBuilderField } from "../field-transformers";

/** A field group the entity uses, as the Builder loaded it. */
export interface LoadedFieldGroup {
  slug: string;
  label: string;
  fields: FieldDefinition[];
}

/** Why a row offers no change, naming where it is defined. */
export type ReadOnlyReason =
  | { kind: "entity" }
  | { kind: "code" }
  | { kind: "plugin"; owner?: string }
  | { kind: "locked" }
  | { kind: "field-group"; slug: string; label: string };

/** The sentence a read-only row shows: where it is defined. */
export function describeReadOnly(reason: ReadOnlyReason): string {
  switch (reason.kind) {
    case "entity":
    case "code":
      return "Defined in code";
    case "plugin":
      return `Defined by ${reason.owner ?? "a plugin"}`;
    case "locked":
      return "Locked";
    case "field-group":
      return `Defined in the field group ${reason.label}`;
  }
}

/**
 * Whether a field may be changed here, given what its container says.
 *
 * The one read-only rule, for the outline and the settings panel alike. A
 * field beneath a field-group field belongs to that field group, whatever
 * else is true of it. Otherwise a field's own owner is named (a plugin, code),
 * then whatever its container passes down (a read-only entity, a locked or
 * owned container).
 */
function fieldReadOnlyReason(
  field: BuilderField,
  inherited: ReadOnlyReason | null
): ReadOnlyReason | null {
  if (inherited?.kind === "field-group") return inherited;
  if (field.source === "plugin") return { kind: "plugin", owner: field.owner };
  if (field.source === "code") return { kind: "code" };
  if (field.locked === true) {
    return field.owner
      ? { kind: "plugin", owner: field.owner }
      : { kind: "locked" };
  }
  return inherited;
}

/**
 * The read-only reason of a field placed under `ancestors` (outermost first)
 * in an entity that may itself be read-only: the rule above, applied down the
 * chain, so a field inside an owned container is read-only as the outline
 * shows it.
 */
export function placementReadOnlyReason(
  field: BuilderField,
  ancestors: readonly BuilderField[],
  entityReadOnly: boolean
): ReadOnlyReason | null {
  let reason: ReadOnlyReason | null = entityReadOnly
    ? { kind: "entity" }
    : null;
  for (const ancestor of ancestors) {
    reason = fieldReadOnlyReason(ancestor, reason);
  }
  return fieldReadOnlyReason(field, reason);
}

/** The kinds of row that hold other rows. */
export type OutlineContainer =
  | "group"
  | "repeater"
  | "field-group"
  | "field-group-entry"
  | "blocks";

/** One row of the outline and the rows beneath it. */
export interface OutlineNode {
  /** The field's id in the Builder; a field group's fields get one derived from their place. */
  id: string;
  /**
   * The row's place by name, outermost first ("sections/items/cta"). Field ids
   * are minted afresh on every load, so anything remembered across loads, such
   * as what is folded, is keyed by this instead.
   */
  path: string;
  field: BuilderField;
  parentId: string | null;
  /** 1 for the entity's own top-level fields. */
  level: number;
  container: OutlineContainer | null;
  children: OutlineNode[];
  readOnly: ReadOnlyReason | null;
  /** In the entity's own definition, as opposed to a field group's. */
  own: boolean;
  /** For a field-group field: the field groups it uses, and what could not be shown. */
  fieldGroup?: { slugs: string[]; missing: string[]; cycle: boolean };
  /** For a blocks field: how many blocks it accepts. */
  blocks?: { accepted: number | "all" };
}

interface BuildContext {
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
}

/** A field group's own field, as a Builder field with an id from its place. */
function derivedField(definition: FieldDefinition, id: string): BuilderField {
  // A field group's own fields are never the entity's built-in fields.
  const field = convertToBuilderField(definition, 0, true);
  const withIds = (f: BuilderField, fid: string): BuilderField => ({
    ...f,
    id: fid,
    fields: f.fields?.map(child => withIds(child, `${fid}/${child.name}`)),
  });
  return withIds(field, id);
}

function containerOf(field: BuilderField): OutlineContainer | null {
  if (field.type === "group") return "group";
  if (field.type === "repeater") return "repeater";
  if (isFieldGroupFieldType(field.type)) return "field-group";
  if (field.type === "blocks") return "blocks";
  return null;
}

/** Where a level of the outline sits: what holds it, and what it inherits. */
interface Level {
  parent: OutlineNode | null;
  inherited: ReadOnlyReason | null;
  /** Field groups already open above this level, so a cycle stops. */
  chain: readonly string[];
  /** In the entity's own definition, as opposed to a field group's. */
  own: boolean;
}

/** One field's row, before what it holds is filled in. */
function nodeFor(field: BuilderField, level: Level): OutlineNode {
  const { parent } = level;
  const segment = field.name || `#${field.id}`;
  return {
    id: field.id,
    path: parent ? `${parent.path}/${segment}` : segment,
    field,
    parentId: parent?.id ?? null,
    level: parent ? parent.level + 1 : 1,
    container: containerOf(field),
    children: [],
    readOnly: fieldReadOnlyReason(field, level.inherited),
    own: level.own,
  };
}

/** Fill in what a row holds: its own fields, a field group's, or what a blocks field accepts. */
function fillContainer(
  node: OutlineNode,
  ctx: BuildContext,
  level: Level
): void {
  switch (node.container) {
    case "group":
    case "repeater":
      node.children = buildLevel(node.field.fields ?? [], ctx, {
        ...level,
        parent: node,
        inherited: node.readOnly,
      });
      return;
    case "field-group":
      fillFieldGroup(node, ctx, level.chain);
      return;
    case "blocks": {
      const allow = node.field.blocks?.allow;
      node.blocks = {
        accepted: allow && allow.length > 0 ? allow.length : "all",
      };
      return;
    }
    default:
      return;
  }
}

function buildLevel(
  fields: readonly BuilderField[],
  ctx: BuildContext,
  level: Level
): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  for (const field of fields) {
    // The entity's built-in fields are shown above the outline, not in it.
    // Only its own top level holds them: a field of that name in a container
    // or a field group is an ordinary field there.
    if (field.isSystem && level.parent === null && level.own) continue;
    const node = nodeFor(field, level);
    fillContainer(node, ctx, level);
    nodes.push(node);
  }
  return nodes;
}

/** The fields of one field group, beneath `parent`, read-only and marked as its. */
function fieldGroupChildren(
  slug: string,
  parent: OutlineNode,
  ctx: BuildContext,
  chain: readonly string[]
): OutlineNode[] | "missing" | "cycle" {
  if (chain.includes(slug)) return "cycle";
  const group = ctx.fieldGroups.get(slug);
  if (!group) return "missing";
  const fields = group.fields.map(definition =>
    derivedField(definition, `${parent.id}/${definition.name}`)
  );
  return buildLevel(fields, ctx, {
    parent,
    inherited: { kind: "field-group", slug, label: group.label },
    chain: [...chain, slug],
    own: false,
  });
}

function fillFieldGroup(
  node: OutlineNode,
  ctx: BuildContext,
  chain: readonly string[]
): void {
  const refs = extractFieldGroupReferences(node.field);
  const slugs =
    refs.single !== undefined ? [refs.single] : [...(refs.many ?? [])];
  const missing: string[] = [];
  let cycle = false;
  const record = (
    slug: string,
    result: ReturnType<typeof fieldGroupChildren>
  ) => {
    if (result === "missing") missing.push(slug);
    else if (result === "cycle") cycle = true;
    return Array.isArray(result) ? result : [];
  };

  if (refs.single !== undefined) {
    node.children = record(
      refs.single,
      fieldGroupChildren(refs.single, node, ctx, chain)
    );
  } else {
    // A field that accepts several field groups shows each as a row of its
    // own, with that field group's fields beneath it.
    node.children = slugs.map(slug => {
      const group = ctx.fieldGroups.get(slug);
      const entry: OutlineNode = {
        id: `${node.id}/@${slug}`,
        path: `${node.path}/@${slug}`,
        field: {
          id: `${node.id}/@${slug}`,
          name: slug,
          label: group?.label ?? slug,
          type: "component",
          component: slug,
        },
        parentId: node.id,
        level: node.level + 1,
        container: "field-group-entry",
        children: [],
        readOnly: { kind: "field-group", slug, label: group?.label ?? slug },
        own: false,
      };
      entry.children = record(
        slug,
        fieldGroupChildren(slug, entry, ctx, chain)
      );
      return entry;
    });
  }
  node.fieldGroup = { slugs, missing, cycle };
}

/**
 * The outline of an entity: its own fields at every depth, with the fields of
 * each field group it uses beneath the field that uses it.
 */
export function buildOutline(
  fields: readonly BuilderField[],
  options: {
    entityReadOnly: boolean;
    fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
  }
): OutlineNode[] {
  return buildLevel(
    fields,
    { fieldGroups: options.fieldGroups },
    {
      parent: null,
      inherited: options.entityReadOnly ? { kind: "entity" } : null,
      chain: [],
      own: true,
    }
  );
}

/** Every node of the outline, outermost first, in order. */
export function flattenOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  const all: OutlineNode[] = [];
  const walk = (list: readonly OutlineNode[]) => {
    for (const node of list) {
      all.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return all;
}

/** The path of every row that holds rows: what "fold all" folds. */
export function containerPaths(nodes: readonly OutlineNode[]): string[] {
  return flattenOutline(nodes)
    .filter(node => node.children.length > 0)
    .map(node => node.path);
}

/** One row as drawn: its node, its place among its siblings, and whether it is open. */
export interface VisibleRow {
  node: OutlineNode;
  level: number;
  posinset: number;
  setsize: number;
  /** Undefined for a row that holds nothing. */
  expanded: boolean | undefined;
  /** Matches what is being looked for (false when nothing is). */
  match: boolean;
}

/** Whether a row matches a find: its label, its name or its type's plain name. */
function rowMatches(
  node: OutlineNode,
  query: string,
  typeLabel: (type: string) => string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const { label, name, type } = node.field;
  return [label, name, type, typeLabel(type)].some(
    text => typeof text === "string" && text.toLowerCase().includes(q)
  );
}

/**
 * The rows to draw, in order.
 *
 * With nothing looked for, every row whose containers are open. While a find
 * is typed, only the rows that match and the containers above them, open
 * whatever was folded, so every match can be seen in its place.
 */
export function visibleRows(
  nodes: readonly OutlineNode[],
  folded: ReadonlySet<string>,
  query: string,
  typeLabel: (type: string) => string
): VisibleRow[] {
  const finding = query.trim() !== "";
  const matches = new Set<string>();
  const shown = new Set<string>();
  if (finding) {
    const mark = (list: readonly OutlineNode[], above: OutlineNode[]) => {
      for (const node of list) {
        if (rowMatches(node, query, typeLabel)) {
          matches.add(node.id);
          shown.add(node.id);
          for (const ancestor of above) shown.add(ancestor.id);
        }
        mark(node.children, [...above, node]);
      }
    };
    mark(nodes, []);
  }

  const rows: VisibleRow[] = [];
  const emit = (list: readonly OutlineNode[]) => {
    const siblings = finding ? list.filter(node => shown.has(node.id)) : list;
    siblings.forEach((node, index) => {
      const holds = node.children.length > 0;
      const openForFind =
        finding && node.children.some(child => shown.has(child.id));
      const expanded = holds
        ? finding
          ? openForFind
          : !folded.has(node.path)
        : undefined;
      rows.push({
        node,
        level: node.level,
        posinset: index + 1,
        setsize: siblings.length,
        expanded,
        match: matches.has(node.id),
      });
      if (expanded) emit(node.children);
    });
  };
  emit(nodes);
  return rows;
}

/**
 * Where a row sits, as the settings panel reads it: the fields holding it,
 * outermost first, and the others beside it. For a field group's field, which
 * the Builder does not hold as its own, this is the only way to place it.
 */
export function nodePlacement(
  node: OutlineNode,
  byId: ReadonlyMap<string, OutlineNode>,
  top: readonly OutlineNode[]
): FieldPlacement {
  const ancestors: BuilderField[] = [];
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  while (parent) {
    ancestors.unshift(parent.field);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  const holder = node.parentId ? byId.get(node.parentId) : undefined;
  const around = holder ? holder.children : top;
  return {
    field: node.field,
    ancestors,
    siblings: around
      .filter(other => other.id !== node.id)
      .map(other => other.field),
  };
}
