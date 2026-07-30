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

/**
 * Throw `NextlyError.validation` if any field's own type rejects its
 * declaration, naming the entity and the option at fault.
 */
export function assertPluginFieldDeclarations(config: SchemaLikeConfig): void {
  const errors: Array<{ path: string; code: string; message: string }> = [];

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

  const entities: Array<[string, FieldBearingEntity[] | undefined]> = [
    ["collections", config.collections],
    ["singles", config.singles],
    ["fieldGroups", config.fieldGroups],
  ];

  for (const [kind, list] of entities) {
    for (const entity of list ?? []) {
      walk(entity.fields, `${kind}.${entity.slug ?? "unknown"}`);
    }
  }

  if (errors.length > 0) {
    throw NextlyError.validation({ errors });
  }
}
