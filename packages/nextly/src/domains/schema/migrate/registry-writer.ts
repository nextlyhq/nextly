/**
 * Brings each collection, Single and field group registry row the registry
 * source records to that record (`registry-source.ts`), writing nothing to a
 * row that already matches. A row of an entity the source does not hold is
 * left as it is: removing one deletes data, which only an applied migration
 * that drops the entity may do.
 *
 * Each declaration is turned into a row by the projection the start's
 * code-first sync uses for a config entry, or, for a Builder entity, by the
 * one its generated registry upsert uses, so `nextly migrate`, a start and a
 * migration file agree on what a matching row is.
 *
 * @module domains/schema/migrate/registry-writer
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { isReservedResourceSlug } from "../../../schemas/_zod/rbac";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import type { Logger } from "../../../shared/types";
import {
  CollectionRegistryService,
  type CodeFirstCollectionConfig,
} from "../../collections/services/collection-registry-service";
import {
  toCodeFirstCollectionConfig,
  type CodeFirstCollectionSource,
} from "../../collections/services/collection-sync-service";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  FieldGroupRegistryService,
  toCodeFirstComponentConfig,
  type CodeFirstComponentConfig,
  type CodeFirstComponentSource,
} from "../../field-groups/services/field-group-registry-service";
import {
  SingleRegistryService,
  toCodeFirstSingleConfig,
  type CodeFirstSingleConfig,
  type CodeFirstSingleSource,
} from "../../singles/services/single-registry-service";
import type {
  RecordedEntitySettings,
  SettingsEntityKind,
} from "../migrate-create/entity-settings";
import {
  collectionRowValues,
  componentRowValues,
  singleRowValues,
} from "../ui-schema/metadata-sql";

import type { RegistrySource } from "./registry-source";

export interface RegistryWriteDeps {
  adapter: DrizzleAdapter;
  logger: Logger;
  /**
   * Asked before each row is written, and throws once this run can no longer
   * show it holds the schema lock: a run that lost the lock writes nothing
   * further. Absent, every write goes ahead.
   */
  assertLockHeld?: () => Promise<void> | void;
}

export interface RegistryWriteResult {
  /** Rows created or rewritten, by kind. */
  written: Record<SettingsEntityKind, number>;
  /** Entities whose row could not be written, as `<kind> <slug>`. */
  failed: string[];
}

/** One row the source asks for, and how to bring the registry to it. */
interface RecordedRow {
  kind: SettingsEntityKind;
  slug: string;
  write: () => Promise<"created" | "updated" | "unchanged">;
}

/** Brings the registry to `source`, row by row, under the caller's lock. */
export async function writeRegistryFromSource(
  source: Extract<RegistrySource, { kind: "snapshot" }>,
  deps: RegistryWriteDeps
): Promise<RegistryWriteResult> {
  const result: RegistryWriteResult = {
    written: { collection: 0, single: 0, fieldGroup: 0 },
    failed: [],
  };
  try {
    for (const row of recordedRows(source, deps)) {
      // Outside the per-row guard below: a lost lock stops the pass, it is
      // never one row's failure to report and go on from.
      await deps.assertLockHeld?.();
      try {
        if ((await row.write()) !== "unchanged") result.written[row.kind] += 1;
      } catch (error) {
        // One row that cannot be written costs only that row; the rest are
        // still brought to the source, and the run says which one failed.
        result.failed.push(`${row.kind} ${row.slug}`);
        deps.logger.warn(
          `Could not write the registry row of ${row.kind} "${row.slug}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  } finally {
    // Every cached read of a row may now describe one that changed.
    clearRegistryRowCache();
  }
  return result;
}

/** Every row the source records, in kind order, reserved slugs left out. */
function recordedRows(
  source: Extract<RegistrySource, { kind: "snapshot" }>,
  deps: RegistryWriteDeps
): RecordedRow[] {
  const collections = new CollectionRegistryService(deps.adapter, deps.logger);
  const singles = new SingleRegistryService(deps.adapter, deps.logger);
  const fieldGroups = new FieldGroupRegistryService(deps.adapter, deps.logger);
  // A slug the system keeps for its own resources is never a registry row,
  // whatever a snapshot says.
  const kept = ([slug]: [string, RecordedEntitySettings]) =>
    !isReservedResourceSlug(slug);
  const { entities } = source;
  return [
    ...Object.entries(entities.collections)
      .filter(kept)
      .map(([slug, recorded]) => ({
        kind: "collection" as const,
        slug,
        write: () =>
          collections.writeRecordedCollection(
            recordedCollection(slug, recorded),
            originOf(recorded)
          ),
      })),
    ...Object.entries(entities.singles)
      .filter(kept)
      .map(([slug, recorded]) => ({
        kind: "single" as const,
        slug,
        write: () =>
          singles.writeRecordedSingle(
            recordedSingle(slug, recorded),
            originOf(recorded)
          ),
      })),
    ...Object.entries(entities.fieldGroups)
      .filter(kept)
      .map(([slug, recorded]) => ({
        kind: "fieldGroup" as const,
        slug,
        write: () =>
          fieldGroups.writeRecordedComponent(
            recordedFieldGroup(slug, recorded),
            originOf(recorded)
          ),
      })),
  ];
}

/** A recorded Single, as the code-first sync's payload (`recordedCollection`). */
function recordedSingle(
  slug: string,
  recorded: RecordedEntitySettings
): CodeFirstSingleConfig {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    // `defineSingle` gives every Single an admin object, empty where the
    // config declares no option, and a snapshot drops an object holding only
    // unset options. Restored, so the row stores what a start stores.
    return toCodeFirstSingleConfig({
      admin: {},
      ...declared,
    } as CodeFirstSingleSource);
  }
  const row = singleRowValues(declared as UiSchemaEntity);
  return {
    slug,
    label: row.label,
    fields: row.fields,
    ...(row.description === undefined || row.description === null
      ? {}
      : { description: row.description }),
    tableName: row.tableName,
    status: row.status,
    versions: row.versions,
    revalidate: row.revalidate,
    webhooks: row.webhooks,
    localized: row.localized,
    ...(row.admin === undefined ? {} : { admin: row.admin }),
  };
}

/** A recorded field group, as the code-first sync's payload (`recordedCollection`). */
function recordedFieldGroup(
  slug: string,
  recorded: RecordedEntitySettings
): CodeFirstComponentConfig {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    return toCodeFirstComponentConfig(declared as CodeFirstComponentSource);
  }
  const row = componentRowValues(declared as UiSchemaEntity);
  return {
    slug,
    label: row.label,
    fields: row.fields,
    ...(row.description === undefined || row.description === null
      ? {}
      : { description: row.description }),
    localized: row.localized,
    ...(row.admin === undefined || row.admin === null
      ? {}
      : { admin: row.admin }),
  };
}

/** What a row the writer creates says about where it came from. */
function originOf(recorded: RecordedEntitySettings): {
  source: "code" | "ui";
  locked: boolean;
} {
  // As the start registers a code-first entity and the Builder its own.
  return recorded.source === "code"
    ? { source: "code", locked: true }
    : { source: "ui", locked: false };
}

/**
 * A recorded collection, as the code-first sync's payload: a code-first
 * declaration through the projection the start uses for a config entry, a
 * Builder one through the row its generated registry upsert writes.
 */
function recordedCollection(
  slug: string,
  recorded: RecordedEntitySettings
): CodeFirstCollectionConfig {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    return toCodeFirstCollectionConfig(
      declared as CodeFirstCollectionSource<
        CodeFirstCollectionConfig["fields"][number]
      >
    );
  }
  const row = collectionRowValues(declared as UiSchemaEntity);
  return {
    slug,
    labels: row.labels,
    fields: row.fields,
    ...(row.description === undefined || row.description === null
      ? {}
      : { description: row.description }),
    tableName: row.tableName,
    status: row.status,
    versions: row.versions,
    revalidate: row.revalidate,
    webhooks: row.webhooks,
    localized: row.localized,
    ...(row.admin === undefined ? {} : { admin: row.admin }),
  };
}

/**
 * A recorded declaration, refused unless it holds a field list: a snapshot
 * is read from disk, and a row written from a record without one would
 * clear every field. The refusal costs that row alone (`writeRegistryFromSource`).
 */
function declaration(
  recorded: RecordedEntitySettings
): Record<string, unknown> {
  if (!Array.isArray(recorded.settings.fields)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "fields",
          code: "REQUIRED",
          message: "A recorded declaration holds no field list.",
        },
      ],
      logContext: { source: recorded.source },
    });
  }
  return recorded.settings;
}
