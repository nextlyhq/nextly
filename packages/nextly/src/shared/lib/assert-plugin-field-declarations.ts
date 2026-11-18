/**
 * Boot-time gate for plugin field-type declaration checks.
 *
 * A plugin's own collections, singles and field groups arrive as raw configs: its
 * field type is not registered when its module is evaluated, so it cannot route
 * them through `defineCollection`, which is where a code-first config is
 * checked. Nothing else on the boot path validates them, so without this a
 * declaration a type rejects starts the app and fails later, per write.
 *
 * Scoped to the types' own rules on purpose. Running the general config
 * validators here would newly refuse declarations that boot fine today —
 * deliberately avoided, which is why `plugins/schema/validate-relations.ts`
 * checks relationship targets only. A rule that can fire here, by contrast,
 * belongs to a field type registered in this same process, so it cannot
 * retroactively condemn an existing app's schema.
 *
 * @module shared/lib/assert-plugin-field-declarations
 */
import { ALL_FIELD_TYPES } from "../../collections/fields/types";
import { isPluginFieldTypeOnSurface } from "../../domains/schema/field-types/field-type-registry";
import { describeError } from "../../errors/describe-error";
import { NextlyError } from "../../errors/nextly-error";

import { pluginFieldOptionIssues } from "./plugin-field-options";

/** Canonical tokens, for telling a typo apart from a contributed type. */
const BUILT_IN_FIELD_TYPES = new Set<string>(
  ALL_FIELD_TYPES as readonly string[]
);

/** The shape every entity carrying validatable fields shares. */
interface FieldBearingEntity {
  slug?: string;
  fields?: unknown;
}

interface SchemaLikeConfig {
  collections?: FieldBearingEntity[];
  singles?: FieldBearingEntity[];
  fieldGroups?: FieldBearingEntity[];
}

/** One field declaration a field's own type rejects, at its path. */
export interface FieldDeclarationIssue {
  path: string;
  code: string;
  message: string;
}

/** How an entity is named at the start of an issue's path: `collections.posts` by default. */
type EntityPath = (
  kind: "collections" | "singles" | "fieldGroups",
  index: number,
  entity: FieldBearingEntity
) => string;

const bySlug: EntityPath = (kind, _index, entity) =>
  `${kind}.${entity.slug ?? "unknown"}`;

/**
 * Throw `NextlyError.validation` if any field's own type rejects its
 * declaration, naming the entity and the option at fault
 * (`fieldDeclarationIssues`).
 */
export function assertPluginFieldDeclarations(config: SchemaLikeConfig): void {
  const errors = fieldDeclarationIssues(config);
  if (errors.length > 0) {
    throw NextlyError.validation({ errors });
  }
}

/**
 * Every field declaration in `config` its own type rejects, each at its path, the entity named
 * by `entityPath`. The check `assertPluginFieldDeclarations` makes, for a reader that reports
 * every problem in a configuration rather than stopping at these.
 */
export function fieldDeclarationIssues(
  config: SchemaLikeConfig,
  entityPath: EntityPath = bySlug
): FieldDeclarationIssue[] {
  const errors: FieldDeclarationIssue[] = [];

  const walk = (fields: unknown, basePath: string): void => {
    if (!Array.isArray(fields)) return;
    for (const field of fields) {
      if (field === null || typeof field !== "object") continue;
      const named = field as {
        name?: unknown;
        type?: unknown;
        fields?: unknown;
      };
      const at =
        typeof named.name === "string" ? `${basePath}.${named.name}` : basePath;

      // The `define*` validators cannot answer this: they run while the config
      // bundle is evaluated, before `contributes.fieldTypes`, so every
      // contributed token looks unknown to them and they defer it here. This is
      // the first point where a token no plugin claimed is distinguishable from
      // one that simply had not registered yet — and left unrefused it would
      // reach the schema pipeline and silently build a text column.
      // Registration is not authorization: these entities are all the entries
      // surface, and a type offered only on `forms` or `users` renders a
      // component its author never opted in here. The `define*` validators
      // enforced both, and both have to be re-asked at the only point where the
      // registry is populated.
      if (
        typeof named.type !== "string" ||
        !(
          BUILT_IN_FIELD_TYPES.has(named.type) ||
          isPluginFieldTypeOnSurface(named.type, "entries")
        )
      ) {
        errors.push({
          path: `${at}.type`,
          code: "FIELD_TYPE_INVALID",
          message: `Invalid field type '${String(named.type)}'. No built-in type, and no installed plugin offers it on this surface.`,
        });
        continue;
      }

      for (const issue of pluginFieldOptionIssues(field)) {
        errors.push({
          path: issue.path ? `${at}.${issue.path}` : at,
          code: "FIELD_TYPE_INVALID",
          message: issue.message,
        });
      }
      // Only the container types hold nested fields. A plugin declaration is
      // open-ended, so a custom type may carry its own `fields` option as
      // private configuration, and walking that would run OTHER types' rules
      // over data that is not a field list at all.
      if (named.type === "repeater" || named.type === "group") {
        walk(named.fields, at);
      }
    }
  };

  const entities: Array<
    [
      "collections" | "singles" | "fieldGroups",
      FieldBearingEntity[] | undefined,
    ]
  > = [
    ["collections", config.collections],
    ["singles", config.singles],
    ["fieldGroups", config.fieldGroups],
  ];

  for (const [kind, list] of entities) {
    (list ?? []).forEach((entity, index) => {
      walk(entity.fields, entityPath(kind, index, entity));
    });
  }

  return errors;
}

/**
 * Render a declaration failure as the lines a CLI command reports.
 *
 * The thrown error carries one entry per bad declaration in its public data,
 * while its own message is the generic validation summary — so a command that
 * printed only the message would tell the user something failed without saying
 * which field. Lives beside the throw so the two cannot describe the same
 * failure differently.
 */
export function describeDeclarationFailure(error: unknown): string {
  if (!(error instanceof NextlyError)) return describeError(error);
  const data = error.publicData as
    | { errors?: Array<{ path?: string; message?: string }> }
    | undefined;
  const lines = (data?.errors ?? [])
    .map(issue => `${issue.path ?? ""}: ${issue.message ?? ""}`.trim())
    .filter(line => line !== ":");
  return lines.length > 0 ? lines.join("\n") : describeError(error);
}
