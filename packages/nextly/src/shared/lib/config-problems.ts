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
}

/** The configuration's entities, as far as finding their problems reads them. */
export interface ConfigEntities {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
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
  const fieldTypesOf = (kind: string, index: number) =>
    fieldTypes.filter(
      issue =>
        issue.path === `${kind}[${index}]` ||
        issue.path.startsWith(`${kind}[${index}].`)
    );

  const problems: ConfigProblem[] = [];
  collections.forEach((entry, index) => {
    for (const error of validateCollectionConfig(
      entry as CollectionConfig,
      collectionSlugs
    ).errors) {
      problems.push({
        ...error,
        path: within("collections", index, error.path),
      });
    }
    problems.push(...fieldTypesOf("collections", index));
  });
  singles.forEach((entry, index) => {
    for (const error of validateSingleConfig(entry as SingleConfig).errors) {
      problems.push({ ...error, path: within("singles", index, error.path) });
    }
    problems.push(...fieldTypesOf("singles", index));
  });
  fieldGroups.forEach((entry, index) => {
    for (const error of validateFieldGroupConfig(entry as FieldGroupConfig)
      .errors) {
      problems.push({
        ...error,
        path: within("fieldGroups", index, error.path),
      });
    }
    problems.push(...fieldTypesOf("fieldGroups", index));
  });
  return problems;
}
