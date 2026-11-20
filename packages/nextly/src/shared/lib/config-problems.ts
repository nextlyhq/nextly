/**
 * Every problem in a configuration, found by the rules that judge each entity, in the order the
 * configuration declares them.
 *
 * Each entity kind already has a validator that collects all of its errors without throwing
 * (`validateCollectionConfig`, `validateSingleConfig`, `validateFieldGroupConfig`), and the field
 * types are judged by `fieldDeclarationIssues`. This reads them all together, so a configuration
 * with problems in several entities is reported whole rather than one throw at a time. It decides
 * nothing of its own: a rule lives in its validator, and this only places each finding in the
 * configuration.
 *
 * @module shared/lib/config-problems
 */
import { crossEntityProblems } from "../../collections/config/cross-entity-problems";
import type { CollectionConfig } from "../../collections/config/define-collection";
import { validateCollectionConfig } from "../../collections/config/validate-config";
import { columnsDeclaredBy } from "../../domains/schema/services/field-column-descriptor";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import type { SingleConfig } from "../../singles/config/types";
import { validateSingleConfig } from "../../singles/config/validate-single";

import { fieldDeclarationIssues } from "./assert-plugin-field-declarations";
import { declaredPlaceOf } from "./declared-entity-trace";

/** One problem in a configuration: where it is, which rule it breaks, and what the rule says. */
export interface ConfigProblem {
  /** Where in the configuration, as `collections[1].fields`: the entity by its position. */
  path: string;
  code: string;
  message: string;
  /**
   * Whether the entity was declared through its `define*` function (`markDeclaredByDefine`)
   * rather than written as a plain object. A start refuses the first and warns about the second,
   * which the start never judged before.
   */
  declaredByDefine: boolean;
  /**
   * Whether it breaks a rule across entities (`crossEntityProblems`): one slug each, one table
   * per field group, one Single per address, no cycle among field groups. `defineConfig` refused
   * these at import, whatever declared the entities, so a start refuses them still.
   */
  crossEntity?: boolean;
}

/** The configuration's entities, as far as finding their problems reads them. */
export interface ConfigEntities {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
}

/**
 * The mark a `define*` function leaves on every entity it returns, recording the system fields
 * (`title`, `slug`) it added. A registered symbol, so a second copy of this module (the
 * configuration's bundle beside the runtime's) reads the same one; not enumerable, so no
 * comparison, serialisation or settings record of the entity sees it. The configuration keeps the
 * entity objects the app declared, so the mark is read on them. The fields themselves carry
 * nothing, so every comparison of them is as it was.
 */
const DECLARED_BY_DEFINE = Symbol.for("nextly.config.declaredByDefine");

/** What the mark records of the `define*` call that returned the entity. */
interface DefineRecord {
  /** The system fields the call added, as it added them. */
  systemFields: readonly object[];
}

/** `entity`, marked as one its `define*` function returned, having added `systemFields`. */
export function markDeclaredByDefine<T extends object>(
  entity: T,
  systemFields: readonly object[] = []
): T {
  const record: DefineRecord = Object.freeze({
    systemFields: Object.freeze([...systemFields]),
  });
  Object.defineProperty(entity, DECLARED_BY_DEFINE, { value: record });
  return entity;
}

/** The record `markDeclaredByDefine` left on `entity`, or undefined where it left none. */
function defineRecordOf(entity: unknown): DefineRecord | undefined {
  if (typeof entity !== "object" || entity === null) return undefined;
  const record = (entity as Record<symbol, unknown>)[DECLARED_BY_DEFINE];
  return typeof record === "object" && record !== null
    ? (record as DefineRecord)
    : undefined;
}

/**
 * Whether `field` is one of `systemFields`, or a copy of one: the same settings, each the same
 * value. A plugin's setup may hand back a copy (`{ ...field }`, or the copy it was handed), and
 * a field it adds of the same name declares settings of its own, so it is not one.
 */
function isSystemField(
  field: unknown,
  systemFields: readonly object[]
): boolean {
  if (typeof field !== "object" || field === null) return false;
  const keys = Object.keys(field);
  return systemFields.some(
    added =>
      added === field ||
      (Object.keys(added).length === keys.length &&
        keys.every(
          key =>
            (added as Record<string, unknown>)[key] ===
            (field as Record<string, unknown>)[key]
        ))
  );
}

/**
 * The problems of `entry`: its validator's, of the fields its author declared, the system
 * fields its `define*` call added set aside (`isSystemField`), as the rules judged it when that
 * call threw. A collection with no field of its own breaks the rule that it declare one, and an
 * author's field may share a system field's name where it takes no column of its own (a
 * column-less `Title` beside the added `title`), which the rules would otherwise call one name
 * declared twice.
 *
 * And the one question the system fields raise beside them: whether another field takes a column
 * one of them holds, asked as `defineCollection` asks it before adding them
 * (`columnsDeclaredBy`). A field a plugin's setup adds by a system field's name does, and the
 * table could not be made, so it is reported.
 */
function entryProblems<
  P extends { path: string; code: string; message: string },
>(
  entry: unknown,
  validate: (entry: unknown) => readonly P[],
  systemFields: readonly object[]
): Array<P | { path: string; code: string; message: string }> {
  const fields = (entry as { fields?: unknown } | null)?.fields;
  if (systemFields.length === 0 || !Array.isArray(fields)) {
    return [...validate(entry)];
  }
  const added = fields.filter(field => isSystemField(field, systemFields));
  const authored = fields.filter(field => !added.includes(field));
  const problems: Array<P | { path: string; code: string; message: string }> = [
    ...validate({ ...(entry as object), fields: authored }),
  ];
  for (const system of added) {
    const [column] = columnsDeclaredBy([system as { name?: unknown }]);
    if (column === undefined) continue;
    for (const field of authored) {
      if (!columnsDeclaredBy([field as { name?: unknown }]).has(column))
        continue;
      problems.push({
        path: "fields",
        code: "FIELD_NAME_DUPLICATE",
        message: `Field '${String((field as { name?: unknown }).name)}' takes the column '${column}', which the system field '${String((system as { name?: unknown }).name)}' already holds. Rename it.`,
      });
    }
  }
  return problems;
}

/** `path` within the entity at `kind[index]`, as a path in the whole configuration. */
function within(kind: string, index: number, path: string): string {
  const entity = `${kind}[${index}]`;
  return path === "" ? entity : `${entity}.${path}`;
}

/** An entity's slug, when it has one that is a string. */
function slugOf(entity: unknown): string | undefined {
  const slug = (entity as { slug?: unknown } | null)?.slug;
  return typeof slug === "string" ? slug : undefined;
}

/**
 * Each of the app's `declared` entities as `effective` holds it, where a plugin's setup changed
 * it, else as declared: the form a command uses, in the app's own order. An entity a setup added
 * is a plugin's contribution and keeps its own checks, so it is not among them.
 *
 * Found by the place the copy a setup was handed carries (`traceDeclaredEntities`), which
 * follows an entity a setup renamed; then, for an entity a setup rebuilt without spreading that
 * copy, by its slug. One found neither way is judged as declared, so the check never passes an
 * entity it could not find.
 */
function asUsed(
  kind: string,
  declared: readonly unknown[],
  effective: readonly unknown[] | undefined
): unknown[] {
  if (effective === undefined) return [...declared];
  // Where nothing transformed the configuration, the effective entities are the declared ones:
  // each is itself, so two with one slug are each judged as themselves.
  const held = new Set<unknown>(effective);
  const byPlace = new Map<string, unknown>();
  const bySlug = new Map<string, unknown>();
  for (const entity of effective) {
    const place = declaredPlaceOf(entity);
    if (place !== undefined) {
      if (!byPlace.has(place)) byPlace.set(place, entity);
      continue;
    }
    const slug = slugOf(entity);
    if (slug !== undefined && !bySlug.has(slug)) bySlug.set(slug, entity);
  }
  return declared.map((entity, index) => {
    if (held.has(entity)) return entity;
    const traced = byPlace.get(`${kind}[${index}]`);
    if (traced !== undefined) return traced;
    const slug = slugOf(entity);
    return (slug === undefined ? undefined : bySlug.get(slug)) ?? entity;
  });
}

/**
 * Every problem in the app's collections, Singles and field groups, each placed by the entity's
 * position in `declared`. Each is judged as `effective` holds it, where given: the configuration
 * after the plugins' setups, which is what the commands use. An entity's own problems come before
 * the next entity's, collections first, then Singles, then field groups; each entity's field-type
 * problems follow its other ones.
 *
 * A relationship's target is not judged here: the load and the start resolve targets with every
 * one known, Nextly's own (`users`, `media`), the plugins' and the Schema Builder's.
 */
export function configurationProblems(
  declared: ConfigEntities,
  effective?: ConfigEntities
): ConfigProblem[] {
  const collections = asUsed(
    "collections",
    declared.collections ?? [],
    effective?.collections
  );
  const singles = asUsed("singles", declared.singles ?? [], effective?.singles);
  const fieldGroups = asUsed(
    "fieldGroups",
    declared.fieldGroups ?? [],
    effective?.fieldGroups
  );

  // Only a type nothing offers: a registered type's option problems, and a missing type, are
  // each validator's own.
  const fieldTypes = fieldDeclarationIssues(
    {
      collections: collections as CollectionConfig[],
      singles: singles as SingleConfig[],
      fieldGroups: fieldGroups as FieldGroupConfig[],
    },
    (kind, index) => `${kind}[${index}]`,
    { options: false, missingType: false }
  );

  // Each kind with the validator that judges it, in the order problems are listed.
  const kinds: ReadonlyArray<
    [
      "collections" | "singles" | "fieldGroups",
      readonly unknown[],
      (
        entry: unknown
      ) => ReadonlyArray<Omit<ConfigProblem, "declaredByDefine">>,
    ]
  > = [
    [
      "collections",
      collections,
      entry => validateCollectionConfig(entry as CollectionConfig).errors,
    ],
    [
      "singles",
      singles,
      entry => validateSingleConfig(entry as SingleConfig).errors,
    ],
    [
      "fieldGroups",
      fieldGroups,
      entry => validateFieldGroupConfig(entry as FieldGroupConfig).errors,
    ],
  ];

  const problems: ConfigProblem[] = [];
  for (const [kind, entries, validate] of kinds) {
    const declaredEntries = declared[kind] ?? [];
    entries.forEach((entry, index) => {
      // The mark is on the entity the app declared; a setup's copy of it does not carry it.
      const record = defineRecordOf(declaredEntries[index]);
      const byDefine = record !== undefined;
      for (const error of entryProblems(
        entry,
        validate,
        record?.systemFields ?? []
      )) {
        problems.push({
          ...error,
          path: within(kind, index, error.path),
          declaredByDefine: byDefine,
        });
      }
      for (const issue of fieldTypes) {
        if (
          issue.path === `${kind}[${index}]` ||
          issue.path.startsWith(`${kind}[${index}].`)
        ) {
          problems.push({ ...issue, declaredByDefine: byDefine });
        }
      }
    });
  }
  // The rules across entities, judged over the entities as the commands use them.
  for (const problem of crossEntityProblems({
    collections,
    singles,
    fieldGroups,
  })) {
    problems.push({ ...problem, declaredByDefine: false, crossEntity: true });
  }
  return problems;
}
