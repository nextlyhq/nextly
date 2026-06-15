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
import type { PluginDefinition } from "../plugin-context";
import {
  crossPluginRelationError,
  relationTargetMissingError,
} from "../schema-error";

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

/** All entities a plugin contributes (collections + singles + components). */
function pluginEntities(plugin: PluginDefinition): FieldedEntity[] {
  const c = plugin.contributes;
  return [
    ...((c?.collections ?? []) as unknown as FieldedEntity[]),
    ...((c?.singles ?? []) as unknown as FieldedEntity[]),
    ...((c?.components ?? []) as unknown as FieldedEntity[]),
  ];
}

/**
 * @experimental Enforce that a plugin relating to ANOTHER plugin's entity
 * declares `dependsOn` on that plugin (D15). Relations to code/core entities or
 * to the plugin's own entities need no declaration. Throws
 * `NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION`.
 */
export function validateCrossPluginRelations(
  plugins: PluginDefinition[]
): void {
  // slug → owning plugin name (plugin-contributed entities only).
  const owner = new Map<string, string>();
  for (const plugin of plugins) {
    for (const entity of pluginEntities(plugin)) {
      owner.set(entity.slug, plugin.name);
    }
  }

  // Check each relationship field's relationTo: if it targets an entity owned
  // by a DIFFERENT plugin, the source plugin must declare dependsOn on it.
  const checkFields = (
    fields: RelationField[] | undefined,
    source: PluginDefinition
  ): void => {
    for (const fieldEntry of fields ?? []) {
      if (fieldEntry.type !== "relationship" || fieldEntry.relationTo == null) {
        continue;
      }
      const targets = Array.isArray(fieldEntry.relationTo)
        ? fieldEntry.relationTo
        : [fieldEntry.relationTo];
      for (const target of targets) {
        if (typeof target !== "string") continue;
        const targetOwner = owner.get(target);
        if (
          targetOwner &&
          targetOwner !== source.name &&
          !(source.dependsOn ?? {})[targetOwner]
        ) {
          throw crossPluginRelationError(source.name, targetOwner, target);
        }
      }
    }
  };

  for (const plugin of plugins) {
    for (const entity of pluginEntities(plugin)) {
      checkFields(entity.fields, plugin);
    }
    // Relations injected via `contributes.extend` are owned by the EXTENDING
    // plugin, so they must also declare dependsOn for cross-plugin targets (D15).
    for (const clause of plugin.contributes?.extend ?? []) {
      checkFields(clause.fields, plugin);
    }
  }
}
