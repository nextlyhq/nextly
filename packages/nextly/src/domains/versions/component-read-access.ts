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
  forEachFieldGroupInstance,
  nameOf,
  subFieldsOf,
  type ComponentFieldMap,
} from "../field-groups/field-group-instances";
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
export type { ComponentFieldMap };

/**
 * Apply each component's own field read rules to the instances `entry` holds,
 * in place: a field the caller may not read is removed from its instance.
 * Walks groups and repeaters to reach components nested in them, and
 * components nested in components, through the one walk every pass over a
 * document's field groups shares.
 */
export async function applyComponentReadAccess(
  entry: Record<string, unknown>,
  fields: readonly FieldConfig[],
  componentFields: ComponentFieldMap,
  caller: ComponentReadCaller
): Promise<void> {
  await forEachFieldGroupInstance(
    entry,
    fields,
    componentFields,
    ({ instance, slug }) =>
      applyFieldReadAccess(
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
      ),
    {
      declaredComponentDecides: caller.declaredComponentDecides === true,
      // A live read withholds what no rules can judge; a version keeps it.
      withholdMalformed: caller.declaredComponentDecides === true,
    }
  );
}

/**
 * The rows a container value holds, through the same parse the redaction
 * used, so a container held as JSON text reports what was withheld inside it.
 */
function containerRows(value: unknown): Record<string, unknown>[] {
  return openNestedContainer(value)?.rows ?? [];
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
      const beforeRows = containerRows(beforeObj[name]);
      const afterRows = containerRows(afterObj[name]);
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
