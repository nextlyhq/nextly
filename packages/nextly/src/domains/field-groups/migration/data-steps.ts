/**
 * Turns the field-group vocabulary rewrites into migration steps.
 *
 * These steps move what is *inside* rows; `steps.ts` moves the tables and
 * columns the rows live in. They are built separately because the two are
 * different work with different guarantees — a rename is DDL and is only atomic
 * on two of the three dialects, while every rewrite here is ordinary DML and
 * commits or does not.
 *
 * 🔴 **These steps run before any rename, in both directions.** That is not a
 * preference. The adapter's typed CRUD resolves a table through the schema
 * registry and refuses any name the ORM does not declare, and the field-group
 * registry is declared under its legacy name — so it is reachable through that
 * path only while it still carries it. Going through the ORM is what makes the
 * driver's JSON encoding the ORM's problem rather than this module's: the same
 * column is `jsonb` on Postgres, `json` on MySQL and text-with-a-json-mode on
 * SQLite, and two of the three hand back an object where the third hands back a
 * string. Ordering the plan so that never has to be discovered here is worth
 * more than the freedom to put these steps anywhere.
 *
 * Inverting the plan puts them last on the way down, by which point the renames
 * have restored the names they address. So the same rule holds in both
 * directions, and no step here has to work out which name a table is currently
 * under.
 *
 * @module domains/field-groups/migration/data-steps
 */

import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { MetaService } from "../../meta/services/meta-service";

import { MIGRATION_TARGET } from "./manifest";
import { rewriteConfigPath } from "./rewrite-config-path";
import { rewriteContentKey } from "./rewrite-content-key";
import {
  rewriteFieldDefinitions,
  type FieldGroupVocabulary,
} from "./rewrite-field-definitions";
import {
  documentDiffers,
  findUnrewrittenRow,
  readProperty,
  readRowId,
  rewriteRowsInBatches,
  whereRowId,
  type Narrowed,
  type RowRewriteTarget,
} from "./rewrite-rows";
import type { MigrationStep } from "./runner";

/**
 * Every spelling of the field-group concept that is stored inside a row.
 *
 * One object rather than loose arguments so a direction is a single value: a
 * rollback passes the same pair the other way round, and no caller can swap one
 * half of a vocabulary while leaving the rest.
 */
export interface FieldGroupStorageVocabulary {
  /** Leading directory segment of a registry row's `config_path`. */
  readonly configPathDir: string;
  /** How a stored field definition spells a field-group field. */
  readonly fields: FieldGroupVocabulary;
  /** The key a dynamic-zone instance announces its type under, once it is JSON. */
  readonly wireTypeKey: string;
  /** The `scope_kind` a schema event carries when it concerns a field group. */
  readonly schemaEventScope: string;
}

/** What deployed databases spell today. */
export const LEGACY_STORAGE_VOCABULARY: FieldGroupStorageVocabulary = {
  configPathDir: STORAGE_FORMAT.configPathDir,
  fields: {
    fieldType: STORAGE_FORMAT.fieldType,
    refKeys: STORAGE_FORMAT.refKeys,
  },
  wireTypeKey: STORAGE_FORMAT.wireTypeKey,
  schemaEventScope: STORAGE_FORMAT.schemaEventScope,
};

/**
 * What they spell afterwards.
 *
 * `refKeys` carries no legacy spelling, which is what retires that key rather
 * than renaming it: rows holding it are normalised onto the canonical one, and
 * a rollback has none to put back because nothing ever wrote it.
 */
export const FIELD_GROUP_STORAGE_VOCABULARY: FieldGroupStorageVocabulary = {
  configPathDir: MIGRATION_TARGET.configPathDir,
  fields: {
    fieldType: MIGRATION_TARGET.fieldType,
    refKeys: MIGRATION_TARGET.refKeys,
  },
  wireTypeKey: MIGRATION_TARGET.wireTypeKey,
  schemaEventScope: MIGRATION_TARGET.schemaEventScope,
};

/**
 * Registry tables holding stored field definitions.
 *
 * Spelled here rather than taken from `STORAGE_FORMAT`, because only one of them
 * names the field-group concept. The other two are collection and single
 * storage, and they hold field-group *references* inside their own definitions —
 * which is exactly why they have to be rewritten too, and why they do not move
 * when the concept is renamed.
 */
const DEFINITION_TABLES = [
  "dynamic_collections",
  "dynamic_singles",
  STORAGE_FORMAT.registryTable,
] as const;

/** The columns one registry row needs written back. */
type Patch = Record<string, unknown>;

/** Property holding a registry row's stored field definitions. */
const FIELDS_PROPERTY = "fields";

/** Property holding a registry row's source-file path. */
const CONFIG_PATH_PROPERTY = "configPath";

/** The schema-event ledger, and the property naming what an event was about. */
const SCHEMA_EVENTS_TABLE = "nextly_schema_events";
const SCOPE_KIND_PROPERTY = "scopeKind";

/**
 * Ledgers carrying the wire key inside a stored document.
 *
 * Both grow with a site's activity rather than with its schema, so both are
 * walked in batches. `nextly_events` was planned as small and bounded; it is a
 * ledger under a retention window exactly like `nextly_versions`, and sizing one
 * for growth but not the other would be a guess about which fills up first.
 */
const CONTENT_TARGETS: readonly RowRewriteTarget[] = [
  { table: "nextly_versions", documentProperty: "snapshot" },
  { table: "nextly_events", documentProperty: "payload" },
];

/**
 * Build the steps that rewrite stored vocabulary, in canonical order.
 *
 * Direction is which vocabulary is passed as which argument. A rollback is this
 * call with the two exchanged, and the resulting steps reversed along with the
 * rest of the plan.
 */
export function buildDataMigrationSteps(args: {
  meta: MetaService;
  migrationId: string;
  from: FieldGroupStorageVocabulary;
  to: FieldGroupStorageVocabulary;
}): MigrationStep[] {
  const { meta, migrationId, from, to } = args;

  return [
    registryDefinitionsStep(from, to),
    schemaEventScopeStep(from, to),
    ...CONTENT_TARGETS.map(target =>
      contentStep({ meta, migrationId, target, from, to })
    ),
  ];
}

/**
 * Rewrite the vocabulary stored in registry rows.
 *
 * One step over all three registries, in one transaction, deliberately not
 * batched. The runtime builds its schema from these rows, so a half-rewritten
 * set is not partial progress — it is a database whose entities disagree about
 * what a field group is. The set is bounded by how many collections, singles and
 * field groups a project declares, which is the one thing here that does not
 * grow with use.
 *
 * `config_path` travels with it because it is a second spelling on the same rows
 * of the same registry: splitting them would mean reading those rows twice to
 * write two columns that are only ever wrong together.
 */
function registryDefinitionsStep(
  from: FieldGroupStorageVocabulary,
  to: FieldGroupStorageVocabulary
): MigrationStep {
  return {
    id: "data:registry-definitions",
    async run(session) {
      const outcome = await session.inTransaction(async ctx => {
        // Every patch is computed before any of them is issued. A refusal has
        // to leave the transaction as a value rather than as an exception —
        // the adapter reclassifies anything thrown out of a callback and
        // discards the context naming what could not be read — and a value
        // returned from the callback COMMITS. Staging first is what keeps that
        // from committing the rows already rewritten and leaving exactly the
        // mixed-vocabulary registry set this step exists to prevent.
        const staged: { table: string; id: string; patch: Patch }[] = [];
        for (const table of DEFINITION_TABLES) {
          for (const row of await readRegistryRows(ctx, table)) {
            const patch = registryPatch(row, table, from, to);
            if (!patch.ok) return patch;
            if (patch.value === null) continue;
            const id = readRowId(row, table);
            if (!id.ok) return id;
            staged.push({ table, id: id.value, patch: patch.value });
          }
        }
        for (const write of staged) {
          await ctx.update(write.table, write.patch, whereRowId(write.id));
        }
        return { ok: true as const };
      });
      if (!outcome.ok) throw outcome.refusal;
    },
    async verify(session) {
      const outcome = await session.inTransaction(async ctx => {
        for (const table of DEFINITION_TABLES) {
          for (const row of await readRegistryRows(ctx, table)) {
            const patch = registryPatch(row, table, from, to);
            if (!patch.ok) return patch;
            if (patch.value !== null) return { ok: true as const, done: false };
          }
        }
        return { ok: true as const, done: true };
      });
      if (!outcome.ok) throw outcome.refusal;
      return outcome.done;
    },
  };
}

/**
 * Read one registry's rows, projecting only what is rewritten here.
 *
 * `config_path` is projected for every registry even though only the field-group
 * one names the field-group directory. All three declare the column, and asking
 * for it uniformly is what lets `registryPatch` decide by table rather than by
 * which columns happen to have arrived.
 *
 * Locked, for the same reason the ledger walk locks: a plain `SELECT` takes no
 * lock on Postgres or MySQL, and the update writes the whole `fields` document
 * back, so a schema save committing in between would be overwritten rather than
 * merged — a silently lost schema change.
 */
async function readRegistryRows(
  ctx: TransactionContext,
  table: string
): Promise<Record<string, unknown>[]> {
  return ctx.select<Record<string, unknown>>(table, {
    columns: ["id", FIELDS_PROPERTY, CONFIG_PATH_PROPERTY],
    forUpdate: true,
  });
}

/**
 * What one registry row must be updated to, or `null` when it is already right.
 *
 * The same function decides what `run` writes and what `verify` looks for, so
 * the two cannot disagree about whether a row still needs work — a step that
 * ran and then failed its own postcondition is what two implementations of this
 * question would eventually produce.
 */
function registryPatch(
  row: Record<string, unknown>,
  table: string,
  from: FieldGroupStorageVocabulary,
  to: FieldGroupStorageVocabulary
): Narrowed<Patch | null> {
  const patch: Patch = {};

  const fields = readProperty(row, { table, property: FIELDS_PROPERTY });
  if (!fields.ok) return fields;
  const rewrittenFields = rewriteFieldDefinitions(
    fields.value,
    from.fields,
    to.fields
  );
  if (documentDiffers(fields.value, rewrittenFields)) {
    patch[FIELDS_PROPERTY] = rewrittenFields;
  }

  // Only the field-group registry records a path under the renamed directory.
  // A collection's `config_path` names `collections/`, and rewriting it would be
  // renaming a directory this migration has nothing to do with.
  if (table === STORAGE_FORMAT.registryTable) {
    const configPath = readProperty(row, {
      table,
      property: CONFIG_PATH_PROPERTY,
    });
    if (!configPath.ok) return configPath;
    const rewrittenPath = rewriteConfigPath(
      configPath.value,
      from.configPathDir,
      to.configPathDir
    );
    if (documentDiffers(configPath.value, rewrittenPath)) {
      patch[CONFIG_PATH_PROPERTY] = rewrittenPath;
    }
  }

  return { ok: true, value: Object.keys(patch).length === 0 ? null : patch };
}

/**
 * Rewrite the scope a schema event records.
 *
 * The one value in this migration that is a whole column rather than something
 * inside a document, so it is a single conditional update rather than a
 * read-modify-write. Exact equality, not a pattern: the column also holds
 * `collection`, `single`, `core` and `global`, and only one of those is the word
 * being renamed.
 */
function schemaEventScopeStep(
  from: FieldGroupStorageVocabulary,
  to: FieldGroupStorageVocabulary
): MigrationStep {
  const stale: WhereClause = {
    and: [
      { column: SCOPE_KIND_PROPERTY, op: "=", value: from.schemaEventScope },
    ],
  };

  return {
    id: "data:schema-event-scope",
    async run(session) {
      await session.inTransaction(async ctx => {
        await ctx.update(
          SCHEMA_EVENTS_TABLE,
          { [SCOPE_KIND_PROPERTY]: to.schemaEventScope },
          stale
        );
      });
    },
    async verify(session) {
      return session.inTransaction(async ctx => {
        // Asks for one row rather than a count: the question is whether any
        // remain, and a single row answers it without reading the ledger.
        const remaining = await ctx.select<Record<string, unknown>>(
          SCHEMA_EVENTS_TABLE,
          { columns: ["id"], where: stale, limit: 1 }
        );
        return remaining.length === 0;
      });
    },
  };
}

/**
 * Rewrite the wire key inside one ledger's stored documents.
 *
 * Batched and checkpointed, because these are the tables whose size follows a
 * site's history. `verify` rescans the whole table rather than trusting where
 * the batches got to, which is what keeps the checkpoint an optimisation: a
 * cursor that was wrong fails the step instead of passing one that skipped rows.
 */
function contentStep(args: {
  meta: MetaService;
  migrationId: string;
  target: RowRewriteTarget;
  from: FieldGroupStorageVocabulary;
  to: FieldGroupStorageVocabulary;
}): MigrationStep {
  const { meta, migrationId, target, from, to } = args;
  const stepId = `data:${target.table}.${target.documentProperty}`;
  const rewrite = (document: unknown): unknown =>
    rewriteContentKey(document, from.wireTypeKey, to.wireTypeKey);

  return {
    id: stepId,
    async run(session) {
      await rewriteRowsInBatches({
        session,
        meta,
        migrationId,
        stepId,
        target,
        rewrite,
      });
    },
    async verify(session) {
      const unrewritten = await findUnrewrittenRow({
        session,
        target,
        rewrite,
      });
      if (unrewritten === undefined) return true;
      // Named rather than merely reported false. A row the walk did not reach is
      // not "not finished yet" — the walk ran to the end of the table — so an
      // operator needs the row to look at, and a retry needs to be understood as
      // a retry of something that already claimed to be done.
      throw NextlyError.serviceUnavailable({
        logMessage: `field-group migration left a row carrying the old vocabulary: ${target.table}`,
        logContext: {
          reason: "row rewrite did not reach every row",
          table: target.table,
          property: target.documentProperty,
          row: unrewritten,
        },
      });
    },
  };
}
