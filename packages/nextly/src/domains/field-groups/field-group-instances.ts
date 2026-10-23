/**
 * The field-group instances a document holds, wherever they sit.
 *
 * One walk for every pass that judges them by their own field rules, so a
 * read, a history read and a write reach the same instances: a single field
 * group, a repeatable one and each block of a dynamic zone, directly on the
 * document or inside its groups and repeaters, and the ones inside another
 * instance's groups.
 *
 * @module domains/field-groups/field-group-instances
 */

import { isFieldGroupField } from "../../collections/fields/guards";
import type { FieldConfig } from "../../collections/fields/types";
import { openNestedContainer } from "../../shared/lib/field-level-registry";

import {
  extractFieldGroupReferences,
  fieldGroupSlugList,
} from "./storage/field-group-field-type";
import { readFieldGroupType } from "./storage/field-group-type-key";

/** Field-group field schemas, keyed by field-group slug. */
export type ComponentFieldMap = ReadonlyMap<string, readonly FieldConfig[]>;

/**
 * What the walk asks of a schema source: one field group's fields by slug. A
 * map answers it, and so does a resolver a caller already holds.
 */
export interface FieldGroupFieldsBySlug {
  get(slug: string): readonly FieldConfig[] | undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The rows a value holds: an array's records, or the record itself. */
export function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

export function subFieldsOf(
  field: FieldConfig
): readonly FieldConfig[] | undefined {
  const fields = (field as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as FieldConfig[]) : undefined;
}

export function nameOf(field: FieldConfig): string | undefined {
  const name = (field as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * The instances a field-group field's value holds, each with the field group
 * it is judged by: a block's own type (under either stored key), or the field's
 * single field group.
 *
 * In a live document (`declaredComponentDecides`), a field declared with one
 * field group holds only that one, so its instances are judged by it whatever
 * type they claim: a value a hook retagged as a field group with no rules is
 * still judged by the rules it was declared under. A block of a live dynamic
 * zone is judged by its own type only when the zone allows that type; one with
 * no type, or one the zone does not allow, has no rules that can judge it, so
 * its `slug` is `null` and it is withheld whole. A version keeps the type it
 * was captured under, so there the type decides.
 */
export function componentInstances(
  field: FieldConfig,
  value: unknown,
  declaredComponentDecides: boolean
): { slug: string | null; instance: Record<string, unknown> }[] {
  const { single, many } = extractFieldGroupReferences(field);
  const allowed = fieldGroupSlugList(field);
  return rowsOf(value).flatMap(instance =>
    judgingSlugs(readFieldGroupType(instance), {
      single,
      zone: declaredComponentDecides && many !== undefined ? allowed : null,
      declaredComponentDecides,
    }).map(slug => ({ slug, instance }))
  );
}

/**
 * The field groups one instance is judged by, given the type it claims
 * (`own`); see {@link componentInstances}. `zone` is the live dynamic zone's
 * allowed types, or `null` where the claimed type decides. `[null]` withholds
 * the instance whole.
 */
function judgingSlugs(
  own: string | undefined,
  declared: {
    single: string | undefined;
    zone: readonly string[] | null;
    declaredComponentDecides: boolean;
  }
): readonly (string | null)[] {
  const { single, zone } = declared;
  if (zone !== null) {
    return [own !== undefined && zone.includes(own) ? own : null];
  }
  if (declared.declaredComponentDecides && single !== undefined) {
    return [single];
  }
  const slug = own !== undefined && own !== "" ? own : single;
  return slug ? [slug] : [];
}

/** One instance the walk reaches. */
export interface FieldGroupInstanceVisit {
  instance: Record<string, unknown>;
  slug: string;
  /**
   * Whether the instance sits inside a container's value (a group, a repeater
   * row, or another instance) rather than directly on the document. One that
   * sits directly on the document is stored in its field group's own table; one
   * inside a container is stored inline, in that container's column.
   */
  inline: boolean;
  /**
   * The instance directly on the document that this one is held inline in,
   * at any depth; absent for one directly on the document. An inline instance
   * is written with that row, so it is created when that row is.
   */
  outer?: Record<string, unknown>;
}

/**
 * Visit every field-group instance `entry` holds, then what each holds, in
 * document order. `visit` runs on an instance before its own fields are
 * walked, so a pass that removes a field from it removes what lies beneath.
 */
export async function forEachFieldGroupInstance(
  entry: Record<string, unknown>,
  fields: readonly FieldConfig[],
  componentFields: FieldGroupFieldsBySlug,
  visit: (reached: FieldGroupInstanceVisit) => Promise<void>,
  options: {
    declaredComponentDecides: boolean;
    /**
     * Withhold a field-group value that is not an instance (see
     * {@link withholdMalformed}): a live read's answer. A write leaves it to
     * the save, which refuses it as invalid.
     */
    withholdMalformed?: boolean;
  }
): Promise<void> {
  await walkLevel(entry, fields, false, new WeakSet(), undefined);

  async function walkLevel(
    level: Record<string, unknown>,
    levelFields: readonly FieldConfig[],
    inline: boolean,
    open: WeakSet<object>,
    outer: Record<string, unknown> | undefined
  ): Promise<void> {
    for (const field of levelFields) {
      await walkField(level, field, inline, open, outer);
    }
  }

  async function walkField(
    level: Record<string, unknown>,
    field: FieldConfig,
    inline: boolean,
    open: WeakSet<object>,
    outer: Record<string, unknown> | undefined
  ): Promise<void> {
    const name = nameOf(field);
    const sub = subFieldsOf(field);
    // A layout container keeps its fields on the same object, so it is the one
    // descent that recurses on the same value, and the one that can loop: a
    // container whose fields reach itself. `open` holds the containers open on
    // this path and releases each on the way out, so a container shared by
    // several rows is still walked once in each.
    if (name === undefined) {
      if (!sub || open.has(field)) return;
      open.add(field);
      await walkLevel(level, sub, inline, open, outer);
      open.delete(field);
      return;
    }
    if (!isFieldGroupField(field) && !sub) return;
    if (options.withholdMalformed === true && isFieldGroupField(field)) {
      withholdMalformed(level, name);
    }
    // A value held as JSON text (SQLite's shape, or what a hook returned) is
    // parsed, walked, and written back as text, as the entity's own pass does.
    const container = openNestedContainer(level[name]);
    if (container === null) return;
    await walkRows(container.rows, field, inline, outer);
    level[name] = container.serialize();
  }

  /**
   * The rows a named field holds: as instances of its field groups, or as the
   * rows of a group or repeater whose fields may reach more.
   */
  async function walkRows(
    rows: Record<string, unknown>[],
    field: FieldConfig,
    inline: boolean,
    outer: Record<string, unknown> | undefined
  ): Promise<void> {
    if (isFieldGroupField(field)) {
      for (const { slug, instance } of componentInstances(
        field,
        rows,
        options.declaredComponentDecides
      )) {
        if (slug === null) {
          withholdWhole(instance);
          continue;
        }
        await visit({ instance, slug, inline, outer });
        const inner = componentFields.get(slug);
        if (inner) {
          await walkLevel(
            instance,
            inner,
            true,
            new WeakSet(),
            inline ? outer : instance
          );
        }
      }
      return;
    }
    // A row moves to another value, where a loop through the same container is
    // no longer possible, so it starts a fresh set.
    const sub = subFieldsOf(field) ?? [];
    for (const row of rows) {
      await walkLevel(row, sub, true, new WeakSet(), outer);
    }
  }
}

/**
 * Withhold, from a live document, a field-group value that is not an instance:
 * a primitive, text that does not parse, or a list entry that is not a
 * record. No field group's rules can judge one, and a hook may have copied a
 * denied value into it. A version keeps what was captured.
 */
function withholdMalformed(entry: Record<string, unknown>, name: string): void {
  const value = entry[name];
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    if (instancesOnly(value) === undefined) delete entry[name];
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    delete entry[name];
    return;
  }
  const kept = instancesOnly(parsed);
  if (kept === undefined) delete entry[name];
  else entry[name] = JSON.stringify(kept);
}

/**
 * `value` with every entry that is not an instance removed, in place for a
 * list, or `undefined` when it is not an instance or a list at all.
 */
function instancesOnly(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      if (!isRecord(value[i])) value.splice(i, 1);
    }
    return value;
  }
  return isRecord(value) ? value : undefined;
}

/**
 * Remove every field of an instance no rules can judge, in place: judged by
 * several types in turn, one's removals would hide from the next the stored
 * value its rule reads.
 */
function withholdWhole(instance: Record<string, unknown>): void {
  for (const key of Object.keys(instance)) delete instance[key];
}
