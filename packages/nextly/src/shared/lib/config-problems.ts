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
import type { CollectionConfig } from "../../collections/config/define-collection";
import { validateCollectionConfig } from "../../collections/config/validate-config";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import type { SingleConfig } from "../../singles/config/types";
import { validateSingleConfig } from "../../singles/config/validate-single";

import { fieldDeclarationIssues } from "./assert-plugin-field-declarations";

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
}

/** The configuration's entities, as far as finding their problems reads them. */
export interface ConfigEntities {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
}

/**
 * The mark a `define*` function leaves on every entity it returns. A registered symbol, so a
 * second copy of this module (the configuration's bundle beside the runtime's) reads the same
 * one; not enumerable, so no comparison, serialisation or settings record of the entity sees it.
 * The configuration keeps the entity objects the app declared, so the mark is read on them.
 */
const DECLARED_BY_DEFINE = Symbol.for("nextly.config.declaredByDefine");

/** `entity`, marked as one its `define*` function returned. */
export function markDeclaredByDefine<T extends object>(entity: T): T {
  Object.defineProperty(entity, DECLARED_BY_DEFINE, { value: true });
  return entity;
}

/** Whether `entity` carries the mark `markDeclaredByDefine` leaves. */
function declaredByDefine(entity: unknown): boolean {
  return (
    typeof entity === "object" &&
    entity !== null &&
    (entity as Record<symbol, unknown>)[DECLARED_BY_DEFINE] === true
  );
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
 */
function asUsed(
  declared: readonly unknown[],
  effective: readonly unknown[] | undefined
): unknown[] {
  if (effective === undefined) return [...declared];
  const bySlug = new Map<string, unknown>();
  for (const entity of effective) {
    const slug = slugOf(entity);
    if (slug !== undefined && !bySlug.has(slug)) bySlug.set(slug, entity);
  }
  return declared.map(entity => {
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
    declared.collections ?? [],
    effective?.collections
  );
  const singles = asUsed(declared.singles ?? [], effective?.singles);
  const fieldGroups = asUsed(
    declared.fieldGroups ?? [],
    effective?.fieldGroups
  );

  // Only a type nothing offers: a registered type's option problems are each validator's own.
  const fieldTypes = fieldDeclarationIssues(
    {
      collections: collections as CollectionConfig[],
      singles: singles as SingleConfig[],
      fieldGroups: fieldGroups as FieldGroupConfig[],
    },
    (kind, index) => `${kind}[${index}]`,
    { options: false }
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
      const byDefine = declaredByDefine(declaredEntries[index]);
      for (const error of validate(entry)) {
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
  return problems;
}
