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
   * Whether the entity was declared through its `define*` function, which marked it
   * (`withProblemsRecorded`), rather than written as a plain object. A start refuses the first
   * and warns about the second, which the start never judged before.
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
 * The mark a `define*` function leaves on an entity it found problems in. A registered symbol,
 * so a second copy of this module (the configuration's bundle beside the runtime's) reads the
 * same one; enumerable, so a copy of the entity made by spreading it keeps the mark, which JSON
 * and the settings records, reading string keys only, never see.
 */
const PROBLEMS_RECORDED = Symbol.for("nextly.config.problemsRecorded");

/**
 * `entity`, as its `define*` function declares it, marked as one whose problems that function
 * found and left for the configuration's load and start to report, rather than throwing.
 */
export function withProblemsRecorded<T extends object>(entity: T): T {
  return { ...entity, [PROBLEMS_RECORDED]: true };
}

/** Whether `entity` carries the mark `withProblemsRecorded` leaves. */
function problemsRecorded(entity: unknown): boolean {
  return (
    typeof entity === "object" &&
    entity !== null &&
    (entity as Record<symbol, unknown>)[PROBLEMS_RECORDED] === true
  );
}

/** `path` within the entity at `kind[index]`, as a path in the whole configuration. */
function within(kind: string, index: number, path: string): string {
  const entity = `${kind}[${index}]`;
  return path === "" ? entity : `${entity}.${path}`;
}

/**
 * Every problem in `config`'s collections, Singles and field groups, each placed by the entity's
 * position. An entity's own problems come before the next entity's, collections first, then
 * Singles, then field groups; each entity's field-type problems follow its other ones.
 */
export function configurationProblems(config: ConfigEntities): ConfigProblem[] {
  const collections = config.collections ?? [];
  const singles = config.singles ?? [];
  const fieldGroups = config.fieldGroups ?? [];
  // A relationship may name any collection the configuration declares.
  const collectionSlugs = collections
    .map(entry => (entry as { slug?: unknown }).slug)
    .filter((slug): slug is string => typeof slug === "string");

  const fieldTypes = fieldDeclarationIssues(
    {
      collections: collections as CollectionConfig[],
      singles: singles as SingleConfig[],
      fieldGroups: fieldGroups as FieldGroupConfig[],
    },
    (kind, index) => `${kind}[${index}]`
  );

  // Each kind with the validator that judges it, in the order problems are listed.
  const kinds: ReadonlyArray<
    [
      string,
      readonly unknown[],
      (
        entry: unknown
      ) => ReadonlyArray<Omit<ConfigProblem, "declaredByDefine">>,
    ]
  > = [
    [
      "collections",
      collections,
      entry =>
        validateCollectionConfig(entry as CollectionConfig, collectionSlugs)
          .errors,
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
    entries.forEach((entry, index) => {
      const declaredByDefine = problemsRecorded(entry);
      for (const error of validate(entry)) {
        problems.push({
          ...error,
          path: within(kind, index, error.path),
          declaredByDefine,
        });
      }
      for (const issue of fieldTypes) {
        if (
          issue.path === `${kind}[${index}]` ||
          issue.path.startsWith(`${kind}[${index}].`)
        ) {
          problems.push({ ...issue, declaredByDefine });
        }
      }
    });
  }
  return problems;
}
