/**
 * Field read rules inside the components a version holds.
 *
 * `applyFieldReadAccess` judges an entity's own fields, groups and repeaters.
 * A component's fields are declared on the component, and its rules are
 * registered under it (`fieldGroup`), so they are judged here, instance by
 * instance, through the same pass with the component's own registration: a
 * single component, a repeatable one, and each block of a dynamic zone, at
 * any depth. Every history read, comparison and restore runs this after the
 * entity's own pass, so a version shows a reader only what the rules let them
 * read.
 *
 * @module domains/versions/component-read-access
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { isFieldGroupField } from "../../collections/fields/guards";
import type { FieldConfig } from "../../collections/fields/types";
import {
  applyFieldReadAccess,
  getFieldFunctions,
  openNestedContainer,
  type CallerGrants,
  type FieldFunctions,
  type ReadAccessRedactions,
} from "../../shared/lib/field-level-registry";
import {
  extractFieldGroupReferences,
  fieldGroupSlugList,
} from "../field-groups/storage/field-group-field-type";
import { readFieldGroupType } from "../field-groups/storage/field-group-type-key";

/** Who is reading, and their grants, shared with the entity's own pass. */
export interface ComponentReadCaller {
  user?: Record<string, unknown>;
  authenticatedScope?: AuthenticatedScope;
  grants: () => Promise<CallerGrants>;
  /**
   * The store shared by the passes one read makes over a document, so a pass
   * after the hooks restores what an earlier one removed as evidence and
   * re-judges each instance against it, as the entity's own passes do. Keyed
   * by object, so it can be the entity's own store. A read judged once has
   * no use for one.
   */
  redactions?: ReadAccessRedactions;
  /**
   * Set for a live document: a field declared with one component judges its
   * value by that component, whatever type the value claims, since a hook may
   * retag it. Unset for a version, whose snapshot keeps the component it was
   * captured under, which is the one its values were written against.
   */
  declaredComponentDecides?: boolean;
}

/** Component field schemas, keyed by component slug. */
export type ComponentFieldMap = ReadonlyMap<string, readonly FieldConfig[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function subFieldsOf(field: FieldConfig): readonly FieldConfig[] | undefined {
  const fields = (field as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as FieldConfig[]) : undefined;
}

function nameOf(field: FieldConfig): string | undefined {
  const name = (field as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * The component instances a field-group field's value holds, each with the
 * component it is judged by: a block's own type (under either stored key), or
 * the field's single component.
 *
 * In a live document (`declaredComponentDecides`), a field declared with one
 * component holds only that one, so its instances are judged by it whatever
 * type they claim: a value a hook retagged as a component with no rules is
 * still judged by the rules it was declared under. A block of a live dynamic
 * zone is judged by its own type only when the zone allows that type; one
 * with no type, or one the zone does not allow, has no rules that can judge
 * it, so its `slug` is `null` and it is withheld whole. A version keeps the
 * type it was captured under, so there the type decides.
 */
function componentInstances(
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
 * The components one instance is judged by, given the type it claims
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

/**
 * Apply each component's own field read rules to the instances `entry` holds,
 * in place: a field the caller may not read is removed from its instance.
 * Walks groups and repeaters to reach components nested in them, and
 * components nested in components.
 */
export async function applyComponentReadAccess(
  entry: Record<string, unknown>,
  fields: readonly FieldConfig[],
  componentFields: ComponentFieldMap,
  caller: ComponentReadCaller,
  open: WeakSet<object> = new WeakSet()
): Promise<void> {
  for (const field of fields) {
    await judgeField(entry, field, componentFields, caller, open);
  }
}

/** One field of `entry`: its component instances, or the rows it contains. */
async function judgeField(
  entry: Record<string, unknown>,
  field: FieldConfig,
  componentFields: ComponentFieldMap,
  caller: ComponentReadCaller,
  open: WeakSet<object>
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
    await applyComponentReadAccess(entry, sub, componentFields, caller, open);
    open.delete(field);
    return;
  }
  if (!isFieldGroupField(field) && !sub) return;
  // A value held as JSON text (SQLite's shape, or what a hook returned) is
  // parsed, judged, and written back as text, as the entity's own pass does.
  const container = openNestedContainer(entry[name]);
  if (container === null) return;
  await judgeRows(container.rows, field, componentFields, caller);
  entry[name] = container.serialize();
}

/**
 * The rows a named field holds: as instances of its field groups, or as the
 * rows of a group or repeater whose fields may reach more.
 */
async function judgeRows(
  rows: Record<string, unknown>[],
  field: FieldConfig,
  componentFields: ComponentFieldMap,
  caller: ComponentReadCaller
): Promise<void> {
  if (isFieldGroupField(field)) {
    for (const { slug, instance } of componentInstances(
      field,
      rows,
      caller.declaredComponentDecides === true
    )) {
      if (slug === null) withholdWhole(instance);
      else await judgeInstance(instance, slug, componentFields, caller);
    }
    return;
  }
  const sub = subFieldsOf(field) ?? [];
  for (const row of rows) {
    await applyComponentReadAccess(row, sub, componentFields, caller);
  }
}

/**
 * Remove every field of an instance no rules can judge, in place: judged by
 * several types in turn, one's removals would hide from the next the stored
 * value its rule reads.
 */
function withholdWhole(instance: Record<string, unknown>): void {
  for (const key of Object.keys(instance)) delete instance[key];
}

/** One component instance, by its component's own rules, then what it holds. */
async function judgeInstance(
  instance: Record<string, unknown>,
  slug: string,
  componentFields: ComponentFieldMap,
  caller: ComponentReadCaller
): Promise<void> {
  await applyFieldReadAccess(
    {
      kind: "fieldGroup",
      slug,
      entry: instance,
      user: caller.user,
      authenticatedScope: caller.authenticatedScope,
      grants: caller.grants,
      overrideAccess: false,
    },
    caller.redactions
  );
  const inner = componentFields.get(slug);
  if (inner) {
    await applyComponentReadAccess(instance, inner, componentFields, caller);
  }
}

/**
 * The dotted paths of the fields a redaction removed below the top level
 * (`banner.secret`, `meta.secret`), by comparing a copy taken before it with
 * the redacted entry. A field removed from any row or block of a list counts.
 * The top level is the caller's to compare: it holds keys no field declares.
 */
export function nestedWithheldPaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly FieldConfig[],
  componentFields: ComponentFieldMap,
  prefix = ""
): Set<string> {
  const paths = new Set<string>();
  // `open`: the containers open on this value, as in `judgeField`. A descent
  // into a row or an instance moves to another value, where a loop through
  // the same container is no longer possible, so it starts a fresh set.
  const walk = (
    beforeObj: Record<string, unknown>,
    afterObj: Record<string, unknown>,
    level: readonly FieldConfig[],
    at: string,
    open: WeakSet<object> = new WeakSet()
  ): void => {
    for (const field of level) {
      const name = nameOf(field);
      const sub = subFieldsOf(field);
      if (name === undefined) {
        if (sub && !open.has(field)) {
          open.add(field);
          walk(beforeObj, afterObj, sub, at, open);
          open.delete(field);
        }
        continue;
      }
      const path = at === "" ? name : `${at}.${name}`;
      if (at !== "" && name in beforeObj && !(name in afterObj)) {
        paths.add(path);
        continue;
      }
      const beforeRows = rowsOf(beforeObj[name]);
      const afterRows = rowsOf(afterObj[name]);
      beforeRows.forEach((row, index) => {
        const afterRow = afterRows[index];
        if (!afterRow) return;
        const inner = isFieldGroupField(field)
          ? componentFields.get(
              readFieldGroupType(row) ??
                extractFieldGroupReferences(field).single ??
                ""
            )
          : sub;
        if (inner) walk(row, afterRow, inner, path);
      });
    }
  };
  walk(before, after, fields, prefix);
  return paths;
}

function hasReadRule(fns: Record<string, FieldFunctions> | undefined): boolean {
  if (!fns) return false;
  return Object.values(fns).some(
    fn => fn.access?.read !== undefined || hasReadRule(fn.fields)
  );
}

/**
 * What a schema walk has already visited: component slugs, and the container
 * fields themselves. A walk of the schema alone has no data to bottom out on,
 * so any container that reaches itself, named or not, would loop.
 */
interface SchemaSeen {
  slugs: Set<string>;
  containers: WeakSet<object>;
}

function freshSeen(): SchemaSeen {
  return { slugs: new Set(), containers: new WeakSet() };
}

function componentCarriesReadRule(
  slug: string,
  componentFields: ComponentFieldMap,
  seen: SchemaSeen
): boolean {
  if (seen.slugs.has(slug)) return false;
  seen.slugs.add(slug);
  if (hasReadRule(getFieldFunctions("fieldGroup", slug))) return true;
  return reachesComponentRule(
    componentFields.get(slug) ?? [],
    componentFields,
    seen
  );
}

/**
 * Whether any component these fields reach carries a read rule, through
 * groups, repeaters and layout containers as well as components themselves:
 * a component's rules live in its own registration, not its holder's.
 */
function reachesComponentRule(
  level: readonly FieldConfig[],
  componentFields: ComponentFieldMap,
  seen: SchemaSeen
): boolean {
  return level.some(field => {
    if (isFieldGroupField(field)) {
      return fieldGroupSlugList(field).some(slug =>
        componentCarriesReadRule(slug, componentFields, seen)
      );
    }
    const sub = subFieldsOf(field);
    if (sub === undefined || seen.containers.has(field)) return false;
    seen.containers.add(field);
    return reachesComponentRule(sub, componentFields, seen);
  });
}

/**
 * The top-level fields that carry a read rule anywhere beneath them: on the
 * field itself, in a group or repeater it holds, or in a component it reaches.
 * What a redaction withholds when the rules cannot be evaluated.
 */
export function fieldsCarryingReadRules(
  kind: "collection" | "single",
  fields: readonly FieldConfig[],
  componentFields: ComponentFieldMap,
  slug: string
): string[] {
  const own = getFieldFunctions(kind, slug) ?? {};
  const names: string[] = [];
  const visited = new WeakSet<object>();
  const visit = (level: readonly FieldConfig[]): void => {
    for (const field of level) {
      const name = nameOf(field);
      if (name === undefined) {
        const sub = subFieldsOf(field);
        // A schema walk: a container that reaches itself is visited once.
        if (sub && !visited.has(field)) {
          visited.add(field);
          visit(sub);
        }
      } else if (carriesReadRule(field, own[name], componentFields)) {
        names.push(name);
      }
    }
  };
  visit(fields);
  return names;
}

/** Whether a field has a read rule on itself, beneath it, or in its components. */
function carriesReadRule(
  field: FieldConfig,
  fn: FieldFunctions | undefined,
  componentFields: ComponentFieldMap
): boolean {
  if (fn?.access?.read !== undefined || hasReadRule(fn?.fields)) return true;
  return reachesComponentRule([field], componentFields, freshSeen());
}
