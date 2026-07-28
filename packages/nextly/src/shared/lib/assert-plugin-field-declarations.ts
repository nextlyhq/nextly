/**
 * Boot-time gate for plugin field-type declaration checks.
 *
 * A plugin's own collections, singles and components arrive as raw configs: its
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
import { NextlyError } from "../../errors/nextly-error";

import { pluginFieldOptionIssues } from "./plugin-field-options";

/** The shape every entity carrying validatable fields shares. */
interface FieldBearingEntity {
  slug?: string;
  fields?: unknown;
}

interface SchemaLikeConfig {
  collections?: FieldBearingEntity[];
  singles?: FieldBearingEntity[];
  components?: FieldBearingEntity[];
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
      const named = field as { name?: unknown; fields?: unknown };
      const at =
        typeof named.name === "string" ? `${basePath}.${named.name}` : basePath;
      for (const issue of pluginFieldOptionIssues(field)) {
        errors.push({
          path: issue.path ? `${at}.${issue.path}` : at,
          code: "FIELD_TYPE_INVALID",
          message: issue.message,
        });
      }
      // repeater/group hold their own fields, and a plugin type nested in one
      // reaches the database the same way a top-level one does.
      walk(named.fields, at);
    }
  };

  const entities: Array<[string, FieldBearingEntity[] | undefined]> = [
    ["collections", config.collections],
    ["singles", config.singles],
    ["components", config.components],
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
