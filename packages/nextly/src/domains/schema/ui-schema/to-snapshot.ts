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

import type { UiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { buildDesiredSnapshotFromConfig } from "../migrate-create/generate";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { uiToMinimal } from "./merge";

export function uiSchemaToSnapshot(
  manifest: UiSchemaManifest,
  dialect: SupportedDialect
): NextlySchemaSnapshot {
  return buildDesiredSnapshotFromConfig(
    manifest.collections.map(e => uiToMinimal(e, "dc_")),
    manifest.singles.map(e => uiToMinimal(e, "single_")),
    manifest.components.map(e => uiToMinimal(e, STORAGE_FORMAT.tablePrefix)),
    dialect
  );
}
