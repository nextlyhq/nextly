/**
 * Boot-time relationship validation for the merged schema (D15).
 *
 * After the fold (`applyPluginSchemaContributions`), every `relationTo` — on
 * code-first AND plugin-contributed entities — must resolve to a collection in
 * the merged schema (or a core target). This validation does NOT run elsewhere
 * at boot (the on-demand `validateCollectionConfig` is not invoked by
 * `registerServices`), so it is added here. It checks **target existence only**
 * (not field format) to stay additive and avoid surfacing pre-existing
 * format issues as new boot errors.
 *
 * @module plugins/schema/validate-relations
 */

import type { NextlyServiceConfig } from "../../di/register";
import { relationTargetMissingError } from "../schema-error";

// Mirrors CORE_RELATION_TARGETS in domains/schema/ui-schema/cross-file.ts —
// built-in collections that are always valid relationship targets.
const CORE_RELATION_TARGETS = ["users", "media"];

interface RelationField {
  name?: string;
  type?: string;
  relationTo?: string | string[];
}

interface FieldedEntity {
  slug: string;
  fields?: RelationField[];
}

/**
 * @experimental Validate every `relationTo` in the merged config against the
 * merged collection slug set (+ core targets). Throws
 * `NEXTLY_SCHEMA_RELATION_TARGET_MISSING` on the first dangling target (D15).
 */
export function validateMergedRelations(config: NextlyServiceConfig): void {
  const collectionSlugs = new Set<string>([
    ...(config.collections ?? []).map(c => c.slug),
    ...CORE_RELATION_TARGETS,
  ]);

  const entities = [
    ...((config.collections ?? []) as unknown as FieldedEntity[]),
    ...((config.singles ?? []) as unknown as FieldedEntity[]),
    ...((config.components ?? []) as unknown as FieldedEntity[]),
  ];

  for (const entity of entities) {
    for (const fieldEntry of entity.fields ?? []) {
      if (fieldEntry.type !== "relationship" || fieldEntry.relationTo == null) {
        continue;
      }
      const targets = Array.isArray(fieldEntry.relationTo)
        ? fieldEntry.relationTo
        : [fieldEntry.relationTo];
      for (const target of targets) {
        if (typeof target === "string" && !collectionSlugs.has(target)) {
          throw relationTargetMissingError(
            entity.slug,
            fieldEntry.name ?? "",
            target
          );
        }
      }
    }
  }
}
