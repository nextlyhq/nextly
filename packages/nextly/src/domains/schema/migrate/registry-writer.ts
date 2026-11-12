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
import { inRegistryStep } from "../schema-version";
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
  /**
   * The origin of each collection a plugin contributes, `plugin:<name>` by
   * slug, as the start gives it: a row the writer creates for one of them
   * is that plugin's, not the app's.
   */
  collectionSources?: ReadonlyMap<string, `plugin:${string}`>;
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
    for (const row of await recordedRows(source, deps)) {
      // Outside the per-row guard below: a lost lock stops the pass, it is
      // never one row's failure to report and go on from.
      await deps.assertLockHeld?.();
      try {
        // Its own step of the registry write the caller opened, so a row that
        // fails is rolled back alone and the rest still land (`inRegistryStep`).
        if ((await inRegistryStep(deps.adapter, row.write)) !== "unchanged") {
          result.written[row.kind] += 1;
        }
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

/**
 * Every row the source records, in kind order, reserved slugs left out. Each
 * registry table is read once, here, rather than once per entity.
 */
async function recordedRows(
  source: Extract<RegistrySource, { kind: "snapshot" }>,
  deps: RegistryWriteDeps
): Promise<RecordedRow[]> {
  const collections = new CollectionRegistryService(deps.adapter, deps.logger);
  const singles = new SingleRegistryService(deps.adapter, deps.logger);
  const fieldGroups = new FieldGroupRegistryService(deps.adapter, deps.logger);
  // A slug the system keeps for its own resources is never a registry row,
  // whatever a snapshot says.
  const kept = ([slug]: [string, RecordedEntitySettings]) =>
    !isReservedResourceSlug(slug);
  const { entities } = source;
  const [storedCollections, storedSingles, storedFieldGroups] =
    // One after another, each its own step: a registry that cannot be read
    // must not abort the transaction the rows are written in, and steps on
    // one transaction run in turn.
    [
      await storedBySlug(deps.adapter, () => collections.getAllCollections()),
      await storedBySlug(deps.adapter, () => singles.getAllSingles()),
      await storedBySlug(deps.adapter, () => fieldGroups.getAllComponents()),
    ];
  return [
    ...Object.entries(entities.collections)
      .filter(kept)
      .map(([slug, recorded]) => ({
        kind: "collection" as const,
        slug,
        write: () =>
          collections.writeRecordedCollection(
            recordedCollection(slug, recorded),
            collectionOriginOf(recorded, deps.collectionSources?.get(slug)),
            recordedOptions(recorded, storedCollections, slug)
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
            originOf(recorded),
            recordedOptions(recorded, storedSingles, slug)
          ),
      })),
    ...Object.entries(entities.fieldGroups)
      .filter(kept)
      .map(([slug, recorded]) => {
        const { config, tableName } = recordedFieldGroup(slug, recorded);
        return {
          kind: "fieldGroup" as const,
          slug,
          write: () =>
            fieldGroups.writeRecordedComponent(config, originOf(recorded), {
              ...recordedOptions(recorded, storedFieldGroups, slug),
              ...(tableName === undefined ? {} : { tableName }),
            }),
        };
      }),
  ];
}

/**
 * A registry table's rows by slug, read once; undefined where it cannot be
 * read, so each row is read on its own and one that fails costs only itself.
 */
async function storedBySlug<TRecord extends { slug: string }>(
  adapter: DrizzleAdapter,
  read: () => Promise<TRecord[]>
): Promise<ReadonlyMap<string, TRecord> | undefined> {
  try {
    return new Map(
      (await inRegistryStep(adapter, read)).map(row => [row.slug, row])
    );
  } catch {
    return undefined;
  }
}

/**
 * How one recorded entity is handed to its service: its stored row, as read
 * with the rest (`null` when the table holds none), and whether it leaves
 * what it does not say, as a Builder record does.
 */
function recordedOptions<TRecord>(
  recorded: RecordedEntitySettings,
  stored: ReadonlyMap<string, TRecord> | undefined,
  slug: string
): { existing?: TRecord | null; leavesUnsaid: boolean } {
  return {
    ...(stored === undefined ? {} : { existing: stored.get(slug) ?? null }),
    leavesUnsaid: recorded.source === "builder",
  };
}

/**
 * What a row the writer creates says about where it came from, as the start
 * would say it: a code-first entity a plugin contributes is that plugin's
 * (`plugin`), any other code-first one the app's, a Builder one the
 * Builder's. Used only for a row the writer creates.
 */
function originOf(recorded: RecordedEntitySettings): {
  source: "code" | "ui";
  locked: boolean;
} {
  return recorded.source === "code"
    ? { source: "code", locked: true }
    : { source: "ui", locked: false };
}

/** `originOf` for a collection, which a plugin can contribute (`plugin`). */
function collectionOriginOf(
  recorded: RecordedEntitySettings,
  plugin: `plugin:${string}` | undefined
): { source: "code" | "ui" | `plugin:${string}`; locked: boolean } {
  const origin = originOf(recorded);
  return origin.source === "code" && plugin !== undefined
    ? { ...origin, source: plugin }
    : origin;
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

/**
 * A recorded field group, as the code-first sync's payload
 * (`recordedCollection`), and for a Builder one the table its own row names,
 * which its slug can spell differently from the code-first derivation.
 */
function recordedFieldGroup(
  slug: string,
  recorded: RecordedEntitySettings
): { config: CodeFirstComponentConfig; tableName?: string } {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    return {
      config: toCodeFirstComponentConfig(declared as CodeFirstComponentSource),
    };
  }
  const row = componentRowValues(declared as UiSchemaEntity);
  return {
    config: {
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
    },
    tableName: row.tableName,
  };
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
