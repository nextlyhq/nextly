/**
 * Convert a validated `ui-schema.json` manifest to a NextlySchemaSnapshot
 * (spec §4.11 — UI-built half of the merged desired snapshot).
 *
 * Reuses the existing `buildDesiredSnapshotFromConfig` so UI-built and
 * code-first entities produce byte-identical snapshots through one pipeline.
 * Table names follow the canonical prefixes: dc_ / single_ / comp_ with dashes
 * normalized to underscores (matches `resolveCollectionTableName`).
 *
 * @module domains/schema/ui-schema/to-snapshot
 * @since v0.0.3-alpha (Plan D1)
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../migrate-create/generate";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

function toMinimal(
  entities: UiSchemaEntity[],
  prefix: "dc_" | "single_" | "comp_"
): MinimalConfigEntity[] {
  return entities.map(e => ({
    slug: e.slug,
    tableName: `${prefix}${e.slug.replace(/-/g, "_")}`,
    fields: e.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      localized: f.localized,
    })),
    status: e.status === true,
    localized: e.localized === true,
  }));
}

export function uiSchemaToSnapshot(
  manifest: UiSchemaManifest,
  dialect: SupportedDialect
): NextlySchemaSnapshot {
  return buildDesiredSnapshotFromConfig(
    toMinimal(manifest.collections, "dc_"),
    toMinimal(manifest.singles, "single_"),
    toMinimal(manifest.components, "comp_"),
    dialect
  );
}
