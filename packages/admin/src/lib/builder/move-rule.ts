/**
 * Where a field may move in the Builder, and why not where it may not: the one
 * rule a drag, the menu's Move up, Move down and Move to…, and the outline's
 * keys all ask, so every way of moving a field allows and refuses the same.
 *
 * A move takes a field out of its container (the top level, a group or
 * repeating rows) and puts it into another at a chosen place. It is refused,
 * with a sentence saying why, when:
 * - the field, or the container it would enter, is read-only (built in, owned
 *   by code or a plugin, or in a read-only entity), or the container holds no
 *   fields of its own: a field group, whose fields change only in its own
 *   editor, or a blocks field, whose blocks are declared in code;
 * - it would go into itself, or leave repeating rows (each entry may hold
 *   several rows of it, which one field outside cannot keep);
 * - it is unique (a one-to-one among them) and would enter a group or
 *   repeating rows, whose values are kept in one JSON value that cannot be
 *   kept unique;
 * - its name clashes with a field already there, or with one whose delete is
 *   pending, by the server's own clash rule, or is reserved there.
 *
 * Which names clash and which fields are unique are the server's own rules
 * (`nextly/config`), so the outline never offers a move a save refuses.
 *
 * @module lib/builder/move-rule
 */
import { builderColumnIsUnique, siblingNameClash } from "nextly/config";
import type { SiblingClashKind } from "nextly/config";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { isReservedFieldName } from "./constants";
import { convertToFieldDefinition } from "./field-transformers";
import { insertField, type FieldInsertPosition } from "./insert-field";
import {
  describeReadOnly,
  placementReadOnlyReason,
} from "./outline/outline-model";

/** What a move needs to know beyond the fields themselves. */
export interface MoveContext {
  /** Whether the whole entity is read-only (code-first). */
  entityReadOnly: boolean;
  /** Whether the entity's top level reserves built-in names (a collection or a Single). */
  topLevelReservesNames: boolean;
  /**
   * The names a container's pending deletes still hold until the save, keyed
   * by the container's id, or `""` for the top level.
   */
  heldNames?: ReadonlyMap<string, readonly string[]>;
  /** A field group's label and every place using it, for the refusal that names them. */
  describeFieldGroup?: (
    slug: string
  ) => { label: string; usedBy: readonly string[] } | undefined;
  /** Types the surface does not take, wherever they go. */
  excludedTypes?: readonly string[];
  /**
   * For a row that is a field group's own field (shown beneath the field that
   * uses it, never one of the entity's fields), the field using the group:
   * moving it out is refused as moving into it is.
   */
  fieldGroupFieldHolding?: (rowId: string) => BuilderField | undefined;
  /**
   * The ids of the containers a saved field sits in, outermost first, or null for a field never
   * saved. Leaving repeating rows is refused only where the field's saved rows are: a field added
   * there, or moved there, in this unsaved draft has no rows of its own to lose. Without it, every
   * field's rows are taken as saved where it stands.
   */
  savedContainerIdsOf?: (fieldId: string) => readonly string[] | null;
}

/** Why a move is refused. */
export type MoveRefusalReason =
  | "not-found"
  | "read-only"
  | "into-itself"
  | "not-a-container"
  | "into-blocks"
  | "into-field-group"
  | "read-only-container"
  | "out-of-repeating-rows"
  | "unique-into-container"
  | "excluded-type"
  | "name-clash"
  | "reserved-name"
  | "ambiguous-place";

/** A move's answer: the fields after it, or why it is refused. */
export type MoveVerdict =
  | {
      allowed: true;
      fields: BuilderField[];
      /**
       * The repeating rows the field enters, outermost first: its value goes
       * into the first row of each, the other rows hold its default or nothing.
       */
      repeatingRowsEntered: string[];
    }
  | { allowed: false; reason: MoveRefusalReason; message: string };

/** A field's name as a sentence calls it. */
function called(field: BuilderField): string {
  return field.label || field.name || "This field";
}

/** The fields from the top level down to `fieldId`, itself last; null when absent. */
function chainTo(
  fields: readonly BuilderField[],
  fieldId: string
): BuilderField[] | null {
  for (const field of fields) {
    if (field.id === fieldId) return [field];
    const below = field.fields ? chainTo(field.fields, fieldId) : null;
    if (below) return [field, ...below];
  }
  return null;
}

/** The fields one container holds: the top level for none. */
function siblingsIn(
  fields: readonly BuilderField[],
  container: BuilderField | null
): readonly BuilderField[] {
  return container ? (container.fields ?? []) : fields;
}

/** A field's name as the save sends it (`convertToFieldDefinition`), which is what a clash is judged on. */
function sentName(field: BuilderField): string {
  return convertToFieldDefinition(field).name ?? "";
}

/**
 * Whether a field is a layout container: it has no name, so it holds no value of its own, and the
 * fields inside it are stored on the level that holds it (the server's sibling rule).
 */
function isLayoutContainer(field: BuilderField): boolean {
  return sentName(field) === "" && Array.isArray(field.fields);
}

/** The named fields one level holds, those inside its layout containers among them. */
function namedFieldsIn(list: readonly BuilderField[]): BuilderField[] {
  return list.flatMap(each =>
    isLayoutContainer(each) ? namedFieldsIn(each.fields ?? []) : [each]
  );
}

/**
 * The container whose level a field in `chain`'s last container is named on: the nearest one with
 * a name, a layout container being part of the level holding it; null for the top level.
 */
function namingLevel(chain: readonly BuilderField[]): BuilderField | null {
  for (let at = chain.length - 1; at >= 0; at--) {
    if (!isLayoutContainer(chain[at])) return chain[at];
  }
  return null;
}

function refuse(reason: MoveRefusalReason, message: string): MoveVerdict {
  return { allowed: false, reason, message };
}

/** Why the field itself may not move, if it may not. */
function sourceRefusal(
  chain: readonly BuilderField[],
  ctx: MoveContext
): MoveVerdict | null {
  const field = chain[chain.length - 1];
  const reason = field.isSystem
    ? { kind: "code" as const }
    : placementReadOnlyReason(field, chain.slice(0, -1), ctx.entityReadOnly);
  return reason
    ? refuse(
        "read-only",
        `${called(field)} cannot move: ${describeReadOnly(reason).toLowerCase()}.`
      )
    : null;
}

/** Why the container named may not take a field, if it may not. */
function containerRefusal(
  field: BuilderField,
  target: readonly BuilderField[] | null,
  ctx: MoveContext
): MoveVerdict | null {
  if (target === null) return null;
  const container = target[target.length - 1];
  if (container.id === field.id || target.some(each => each.id === field.id)) {
    return refuse("into-itself", `${called(field)} cannot move into itself.`);
  }
  if (container.type === "blocks") {
    return refuse(
      "into-blocks",
      `${called(container)} holds blocks declared in code, not fields.`
    );
  }
  if (isFieldGroupFieldType(container.type)) {
    return fieldGroupRefusal(container, ctx);
  }
  if (container.type !== "group" && container.type !== "repeater") {
    return refuse("not-a-container", `${called(container)} holds no fields.`);
  }
  const reason = placementReadOnlyReason(
    container,
    target.slice(0, -1),
    ctx.entityReadOnly
  );
  return reason
    ? refuse(
        "read-only-container",
        `${called(container)} takes no fields here: ${describeReadOnly(reason).toLowerCase()}.`
      )
    : null;
}

/** The refusal of a move into a field group, naming it and every place that uses it. */
function fieldGroupRefusal(
  container: BuilderField,
  ctx: MoveContext
): MoveVerdict {
  const slug = container.component ?? container.components?.[0] ?? "";
  const described = ctx.describeFieldGroup?.(slug);
  const name = described?.label ?? slug;
  const usedBy =
    described && described.usedBy.length > 0
      ? ` It is used by ${described.usedBy.join(", ")}.`
      : "";
  return refuse(
    "into-field-group",
    `${called(container)} uses the field group ${name}, which is changed only in its own editor, where a change reaches every place that uses it.${usedBy}`
  );
}

/** A field and every field inside it, at any depth. */
function withEverythingInside(field: BuilderField): BuilderField[] {
  return [field, ...(field.fields ?? []).flatMap(withEverythingInside)];
}

/** The repeating rows on a chain of containers, by id. */
function repeatersOn(chain: readonly BuilderField[]): BuilderField[] {
  return chain.filter(each => each.type === "repeater");
}

/** Why the field may not leave or enter the containers it would, if it may not. */
function crossingRefusal(
  field: BuilderField,
  from: readonly BuilderField[],
  into: readonly BuilderField[],
  ctx: MoveContext
): MoveVerdict | null {
  const intoIds = new Set(into.map(each => each.id));
  // Only rows a field is saved in hold values of its own (`savedContainerIdsOf`). Every field the
  // move carries counts, not only the one moved: an unsaved group may hold a field saved in the
  // rows it would leave.
  const savedContainerIdsOf = ctx.savedContainerIdsOf;
  const savedIn = savedContainerIdsOf
    ? new Set(
        withEverythingInside(field).flatMap(
          each => savedContainerIdsOf(each.id) ?? []
        )
      )
    : null;
  const leaving = repeatersOn(from).filter(
    repeater =>
      !intoIds.has(repeater.id) &&
      (savedIn === null || savedIn.has(repeater.id))
  );
  if (leaving.length > 0) {
    return refuse(
      "out-of-repeating-rows",
      `${called(field)} cannot leave its repeating rows: each entry may hold several rows of it, which one field outside them cannot keep. Add a new field there instead.`
    );
  }
  const fromIds = new Set(from.map(each => each.id));
  // A layout container keeps its fields on the level holding it, so entering one puts the value
  // in no JSON value of its own.
  const entersContainer = into.some(
    each => !fromIds.has(each.id) && !isLayoutContainer(each)
  );
  if (
    entersContainer &&
    builderColumnIsUnique(convertToFieldDefinition(field))
  ) {
    return refuse(
      "unique-into-container",
      `${called(field)} is unique, and a group or repeating rows keep their values in one JSON value, which cannot be kept unique. It can move there once it is no longer unique.`
    );
  }
  return null;
}

const CLASH_WORDS: Record<SiblingClashKind, string> = {
  "same-name": "the same name",
  "same-name-ignoring-case": "the same name in other letter case",
  "same-column": "a name that becomes the same column",
};

/** Where a field would arrive, as a sentence names it. */
function placeName(container: BuilderField | null): string {
  return container ? called(container) : "the top level";
}

/** A sibling already there whose name clashes with the field's, if one does. */
function siblingClashRefusal(
  field: BuilderField,
  container: BuilderField | null,
  siblings: readonly BuilderField[]
): MoveVerdict | null {
  for (const other of siblings) {
    // That one object: a copy sharing its id is another field, whose name counts.
    if (other === field) continue;
    const kind = siblingNameClash(sentName(field), sentName(other));
    if (kind) {
      return refuse(
        "name-clash",
        `${called(other)} in ${placeName(container)} has ${CLASH_WORDS[kind]} as ${called(field)}. Rename one of them first.`
      );
    }
  }
  return null;
}

/** A name a pending delete there still holds that clashes with the field's, if one does. */
function heldNameRefusal(
  field: BuilderField,
  container: BuilderField | null,
  ctx: MoveContext
): MoveVerdict | null {
  for (const held of ctx.heldNames?.get(container?.id ?? "") ?? []) {
    const kind = siblingNameClash(sentName(field), held);
    if (kind) {
      return refuse(
        "name-clash",
        `A deleted field in ${placeName(container)}, ${held}, keeps ${CLASH_WORDS[kind]} as ${called(field)} until the delete is saved. Rename ${called(field)} first.`
      );
    }
  }
  return null;
}

/** Why the field's name may not stand among the siblings it would join, if it may not. */
function nameRefusal(
  field: BuilderField,
  container: BuilderField | null,
  siblings: readonly BuilderField[],
  ctx: MoveContext
): MoveVerdict | null {
  const reserved =
    !container &&
    ctx.topLevelReservesNames &&
    isReservedFieldName(sentName(field));
  return (
    siblingClashRefusal(field, container, siblings) ??
    heldNameRefusal(field, container, ctx) ??
    (reserved
      ? refuse(
          "reserved-name",
          `${sentName(field)} is reserved at the top level. Rename ${called(field)} first.`
        )
      : null)
  );
}

/**
 * Why the field may not arrive in another container, if it may not: a field
 * inside it that cannot change place would move with it, or its name may not
 * stand there. A reorder within its own container arrives nowhere new: its
 * siblings are the ones it had, so a clash among them that the saved
 * definition already holds, which a save keeps allowing, is no reason to
 * refuse it.
 */
function arrivalRefusal(
  fields: readonly BuilderField[],
  chain: readonly BuilderField[],
  container: BuilderField | null,
  ctx: MoveContext
): MoveVerdict | null {
  const field = chain[chain.length - 1];
  // Judged by level, not by container: a layout container is part of the level holding it, so
  // moving into or out of one takes the field nowhere new.
  const from = namingLevel(chain.slice(0, -1));
  const into = container
    ? namingLevel(chainTo(fields, container.id) ?? [container])
    : null;
  if ((from?.id ?? null) === (into?.id ?? null)) return null;
  const siblings = namedFieldsIn(siblingsIn(fields, into));
  // A layout container carries its fields' names onto the level it arrives on, not its own.
  const carried = isLayoutContainer(field) ? namedFieldsIn([field]) : [field];
  return (
    lockedInsideRefusal(field, chain, ctx) ??
    carried.reduce<MoveVerdict | null>(
      (refusal, each) => refusal ?? nameRefusal(each, into, siblings, ctx),
      null
    )
  );
}

/**
 * Why a container may not change place, if it may not: a field inside it, at
 * any depth, is built in or owned by code or a plugin, and moving the
 * container would change where that field is stored.
 */
function lockedInsideRefusal(
  field: BuilderField,
  chain: readonly BuilderField[],
  ctx: MoveContext
): MoveVerdict | null {
  const walk = (
    list: readonly BuilderField[],
    ancestors: readonly BuilderField[]
  ): MoveVerdict | null => {
    for (const inner of list) {
      const reason = inner.isSystem
        ? { kind: "code" as const }
        : placementReadOnlyReason(inner, ancestors, ctx.entityReadOnly);
      if (reason) {
        return refuse(
          "read-only",
          `${called(field)} cannot move to another place: ${called(inner)} inside it is ${describeReadOnly(reason).toLowerCase()}, and moving it would change where that field is stored.`
        );
      }
      const below = walk(inner.fields ?? [], [...ancestors, inner]);
      if (below) return below;
    }
    return null;
  };
  return walk(field.fields ?? [], chain);
}

/**
 * Whether `fieldId` may move to `target` (a container, the top level when it
 * names none, and the sibling to go before, the end when none), and the
 * fields after the move when it may.
 */
export function judgeMove(
  fields: readonly BuilderField[],
  fieldId: string,
  target: FieldInsertPosition,
  ctx: MoveContext
): MoveVerdict {
  const chain = chainTo(fields, fieldId);
  if (!chain) {
    const holder = ctx.fieldGroupFieldHolding?.(fieldId);
    return holder
      ? fieldGroupRefusal(holder, ctx)
      : refuse("not-found", "That field is no longer here.");
  }
  const field = chain[chain.length - 1];
  const from = chain.slice(0, -1);
  const into = target.parentFieldId
    ? chainTo(fields, target.parentFieldId)
    : null;
  if (target.parentFieldId && !into) {
    return refuse("not-found", "That place is no longer here.");
  }
  const container = into ? into[into.length - 1] : null;
  const refusal =
    ambiguousPlaceRefusal(fields, container) ??
    sourceRefusal(chain, ctx) ??
    containerRefusal(field, into, ctx) ??
    crossingRefusal(field, from, into ?? [], ctx) ??
    ((ctx.excludedTypes ?? []).includes(field.type)
      ? refuse("excluded-type", `${called(field)} cannot go here.`)
      : null) ??
    arrivalRefusal(fields, chain, container, ctx);
  if (refusal) return refusal;
  const passed = passedReadOnlySibling(
    fields,
    field,
    from,
    container,
    target,
    ctx
  );
  if (passed) return passed;
  return {
    allowed: true,
    fields: placed(fields, field, target),
    repeatingRowsEntered: repeatersOn(into ?? [])
      .filter(repeater => !from.some(each => each.id === repeater.id))
      .map(called),
  };
}

/**
 * Why the field may not go into `container`, if another container shares its id: the move places
 * the field by its container's id, and a copy of a duplicated container keeps the ids inside it,
 * so the move could not tell the two apart.
 */
function ambiguousPlaceRefusal(
  fields: readonly BuilderField[],
  container: BuilderField | null
): MoveVerdict | null {
  return container && fieldsWithId(fields, container.id) > 1
    ? refuse(
        "ambiguous-place",
        `${called(container)} shares its id with a copy of it, so a move there could not tell the two apart. Add a new field there instead.`
      )
    : null;
}

/**
 * How many fields in `fields`, at any depth, have this id: every one the insert could match, a
 * group holding nothing and carrying no `fields` among them, whatever its type.
 */
function fieldsWithId(fields: readonly BuilderField[], id: string): number {
  return fields.reduce(
    (count, each) =>
      count + (each.id === id ? 1 : 0) + fieldsWithId(each.fields ?? [], id),
    0
  );
}

/**
 * `fields` without `field` itself: that one object, where it sits, never
 * another field that happens to share its id.
 */
function withoutField(
  fields: readonly BuilderField[],
  field: BuilderField
): BuilderField[] {
  return fields
    .filter(each => each !== field)
    .map(each =>
      each.fields && each.fields.length > 0
        ? { ...each, fields: withoutField(each.fields, field) }
        : each
    );
}

/** The siblings a reorder to `target` passes over, between the field's place and its new one. */
function siblingsPassed(
  siblings: readonly BuilderField[],
  field: BuilderField,
  target: FieldInsertPosition
): readonly BuilderField[] {
  const at = siblings.indexOf(field);
  const anchor = target.beforeFieldId
    ? siblings.findIndex(each => each.id === target.beforeFieldId)
    : -1;
  const to = anchor === -1 ? siblings.length : anchor;
  return to > at ? siblings.slice(at + 1, to) : siblings.slice(to, at);
}

/** Whether a sibling may not change place: built in, or owned by code or a plugin. */
function cannotChangePlace(
  sibling: BuilderField,
  ancestors: readonly BuilderField[],
  ctx: MoveContext
): boolean {
  return (
    sibling.isSystem === true ||
    placementReadOnlyReason(sibling, ancestors, ctx.entityReadOnly) !== null
  );
}

/**
 * Why a reorder within one container may not happen, if it may not: every
 * sibling between the field's place and its new one changes place too, so
 * none of them may be one that cannot.
 */
function passedReadOnlySibling(
  fields: readonly BuilderField[],
  field: BuilderField,
  from: readonly BuilderField[],
  container: BuilderField | null,
  target: FieldInsertPosition,
  ctx: MoveContext
): MoveVerdict | null {
  const source = from.length > 0 ? from[from.length - 1] : null;
  if ((source?.id ?? null) !== (container?.id ?? null)) return null;
  const fixed = siblingsPassed(
    siblingsIn(fields, container),
    field,
    target
  ).find(each => cannotChangePlace(each, from, ctx));
  return fixed
    ? refuse(
        "read-only",
        `${called(field)} cannot move past ${called(fixed)}, which cannot change place.`
      )
    : null;
}

/** `fields` with `field` taken from where it is and put at `target`. */
function placed(
  fields: readonly BuilderField[],
  field: BuilderField,
  target: FieldInsertPosition
): BuilderField[] {
  // Going before itself is staying put: anchor on the sibling after it.
  const before =
    target.beforeFieldId === field.id
      ? nextSiblingId(fields, field.id)
      : target.beforeFieldId;
  const without = withoutField(fields, field);
  return (
    insertField(without, field, {
      ...(target.parentFieldId ? { parentFieldId: target.parentFieldId } : {}),
      ...(before ? { beforeFieldId: before } : {}),
    }) ?? [...fields]
  );
}

function nextSiblingId(
  fields: readonly BuilderField[],
  fieldId: string
): string | undefined {
  const chain = chainTo(fields, fieldId);
  const container = chain && chain.length > 1 ? chain[chain.length - 2] : null;
  const siblings = siblingsIn(fields, container);
  return siblings[siblings.findIndex(each => each.id === fieldId) + 1]?.id;
}

/** One place a field could go, as Move to… lists it. */
export interface MoveDestination {
  /** The container: none for the top level. */
  parentFieldId?: string;
  /** The containers from the top level to it, outermost first; empty for the top level. */
  path: BuilderField[];
  /** Whether the field may go there, and why not when not. */
  verdict: MoveVerdict;
}

/**
 * Every container the field could be moved into, the top level first, each
 * with this rule's answer for a move to its end, so Move to… lists the places
 * it may go and says why of the ones it may not.
 */
export function moveDestinations(
  fields: readonly BuilderField[],
  fieldId: string,
  ctx: MoveContext
): MoveDestination[] {
  // A place is judged as a container, so the field's own is asked about
  // staying where it is, not about passing whatever sits after it.
  const home = chainTo(fields, fieldId)?.slice(0, -1).pop()?.id;
  const into = (parentFieldId?: string): FieldInsertPosition => ({
    ...(parentFieldId ? { parentFieldId } : {}),
    ...(parentFieldId === home ? { beforeFieldId: fieldId } : {}),
  });
  const places: MoveDestination[] = [
    { path: [], verdict: judgeMove(fields, fieldId, into(), ctx) },
  ];
  const walk = (list: readonly BuilderField[], path: BuilderField[]) => {
    for (const field of list) {
      if (field.id === fieldId) continue;
      const here = [...path, field];
      const holds =
        field.type === "group" ||
        field.type === "repeater" ||
        field.type === "blocks" ||
        isFieldGroupFieldType(field.type);
      if (holds) {
        places.push({
          parentFieldId: field.id,
          path: here,
          verdict: judgeMove(fields, fieldId, into(field.id), ctx),
        });
      }
      if (field.fields) walk(field.fields, here);
    }
  };
  walk(fields, []);
  return places;
}
