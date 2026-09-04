import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import type { FieldGroupAdminOptions } from "../../../field-groups/config/types";
import { MAX_FIELD_GROUP_NESTING_DEPTH } from "../../../field-groups/config/validate-field-group";
// Throws NextlyError so public messages stay generic and never echo a slug,
// while identifiers (slug, source, refs) travel in `logContext` and operators
// keep full diagnostic context.
import type {
  DynamicFieldGroupInsert,
  DynamicFieldGroupRecord,
  FieldGroupMigrationStatus,
  FieldGroupSource,
} from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { BaseRegistryService } from "../../../shared/base-registry-service";
import type {
  BaseListOptions,
  BaseListResult,
} from "../../../shared/base-registry-service";
import type { Logger } from "../../../shared/types";
import { teardownEntityI18n } from "../../i18n/migration/teardown-entity-i18n";
import {
  calculateSchemaHash,
  schemaHashesMatch,
} from "../../schema/services/schema-hash";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import {
  extractFieldGroupReferences,
  isFieldGroupType,
} from "../storage/field-group-field-type";
import { resolveRegistryTableName } from "../storage/resolve-storage-names";

import { teardownEntityComponentData } from "./teardown-entity-field-group-data";

/**
 * A reference to a Component from a Collection, Single, or another Component.
 */
export interface ComponentReference {
  entityType: "collection" | "single" | "component";
  entitySlug: string;
  fieldName: string;
  fieldPath: string;
}

export interface UpdateComponentOptions {
  source?: FieldGroupSource;
  /**
   * Advance `schema_version` even though this write carries no new shape.
   *
   * For the caller whose DDL already landed and whose row write then failed: the tables moved, so
   * every editor loaded before that moment is now describing a shape that no longer exists.
   * `assertSchemaVersionMatch` is the only thing standing between such an editor and an apply
   * against the moved tables, and it compares versions — so a divergence that leaves the version
   * untouched lets a stale preview pass the optimistic lock.
   *
   * The caller states the INTENT and the registry still owns the arithmetic; letting a caller
   * supply the number would let one regress it.
   */
  invalidateSchemaVersion?: boolean;
}

/**
 * Input for registering a code-first Component during sync.
 *
 * Carries no table name: the sync derives the physical name from the slug, so a
 * caller-supplied one could only disagree with the table the schema layer
 * creates.
 */
export interface CodeFirstComponentConfig {
  slug: string;
  label: string;
  fields: DynamicFieldGroupInsert["fields"];
  description?: string;
  admin?: FieldGroupAdminOptions;
  configPath?: string;
  /** i18n: whether the component is localized (translatable fields → companion table). */
  localized?: boolean;
}

export interface SyncComponentResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  errors: Array<{ slug: string; error: string }>;
}

export interface ListComponentsOptions extends BaseListOptions {
  source?: FieldGroupSource;
  migrationStatus?: FieldGroupMigrationStatus;
}

/**
 * Result of listing components with pagination info.
 *
 * Declared as a `type` alias rather than an empty `interface` because the latter
 * triggers @typescript-eslint/no-empty-object-type. The named export is preserved
 * for clearer call-site semantics even though it adds no members today.
 */
export type ListComponentsResult = BaseListResult<DynamicFieldGroupRecord>;

export interface EnrichedComponentSchema {
  label: string;
  fields: Record<string, unknown>[];
  admin?: FieldGroupAdminOptions;
}

export interface EnrichedFieldConfig extends Record<string, unknown> {
  name?: string;
  type?: string;
  componentFields?: Record<string, unknown>[];
  componentSchemas?: Record<string, EnrichedComponentSchema>;
}

export class FieldGroupRegistryService extends BaseRegistryService<
  DynamicFieldGroupRecord,
  FieldGroupMigrationStatus
> {
  protected readonly registryTableName = STORAGE_FORMAT.registryTable;
  protected readonly resourceType = "Component";
  protected readonly tableNamePrefix = STORAGE_FORMAT.tablePrefix;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * The registry table this database actually holds.
   *
   * Unlike the collection and single registries, this one is renamed by the
   * field-group storage migration, so the declared name above is what a
   * database has *before* that runs and not a fact about the database in front
   * of us. Resolved from the catalog and memoized per adapter, so the answer
   * costs one catalog read per process rather than one per query.
   */
  protected override async resolveRegistryTableName(): Promise<string> {
    return resolveRegistryTableName(this.adapter);
  }

  protected getSearchColumns(): string[] {
    return ["slug", "label"];
  }

  async getComponentBySlug(
    slug: string,
    executor?: unknown
  ): Promise<DynamicFieldGroupRecord | null> {
    return this.getRecordBySlug(slug, executor);
  }

  async getComponent(
    slug: string,
    executor?: unknown
  ): Promise<DynamicFieldGroupRecord> {
    return this.getRecordOrThrow(slug, executor);
  }

  async getAllComponents(
    options?: ListComponentsOptions
  ): Promise<DynamicFieldGroupRecord[]> {
    return this.getAllRecords(options);
  }

  async listComponents(
    options?: ListComponentsOptions
  ): Promise<ListComponentsResult> {
    return this.listRecords(options);
  }

  async isLocked(slug: string): Promise<boolean> {
    return this.checkIsLocked(slug);
  }

  async updateMigrationStatus(
    slug: string,
    status: FieldGroupMigrationStatus,
    migrationId?: string
  ): Promise<void> {
    return this.updateRecordMigrationStatus(slug, status, migrationId);
  }

  async updateMigrationStatusWithVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: FieldGroupMigrationStatus }> {
    return this.updateMigrationStatusWithTableVerification(slug, tableName);
  }

  async getPendingMigrations(): Promise<DynamicFieldGroupRecord[]> {
    return this.getRecordsWithPendingMigrations();
  }

  /**
   * Register a new Component in the registry.
   *
   * @throws NextlyError(DUPLICATE) if a Component with the same slug already exists.
   * @throws NextlyError(DATABASE_ERROR) on insert failure.
   */
  async registerComponent(
    data: DynamicFieldGroupInsert
  ): Promise<DynamicFieldGroupRecord> {
    this.logger.debug("Registering Component", { slug: data.slug });

    const existing = await this.getComponentBySlug(data.slug);
    if (existing) {
      // Generic public message; the conflicting slug stays out of the
      // wire and lives in logContext for operator visibility.
      throw NextlyError.duplicate({
        logContext: { reason: "component-slug-conflict", slug: data.slug },
      });
    }

    const now = this.formatDateForDb();
    // Store the caller-resolved physical name verbatim. Callers derive it via
    // resolveComponentTableName; re-prefixing here would desync the registry
    // from the table the schema layer creates.
    const tableName = data.tableName;
    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      label: data.label,
      table_name: tableName,
      description: data.description,
      fields: JSON.stringify(data.fields),
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      // i18n: persist the localized flag so embedded instances route translatable
      // fields to the companion `comp_<slug>_locales` table.
      localized: data.localized === true ? 1 : 0,
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    try {
      const result = await this.adapter.insert<DynamicFieldGroupRecord>(
        await this.resolveRegistryTableName(),
        record,
        { returning: "*" }
      );

      this.logger.info("Component registered", {
        slug: data.slug,
        source: data.source,
      });

      return this.deserializeRecord(result);
    } catch (error) {
      // Spec §8.2 — DB errors map to NextlyError via fromDatabaseError, which
      // produces generic public messages and rich logContext (dbKind, dbCode).
      // Normalise raw driver errors via toDbError(dialect) first so the kind
      // is preserved instead of collapsing to INTERNAL_ERROR.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  async registerComponentInTransaction(
    tx: TransactionContext,
    data: DynamicFieldGroupInsert
  ): Promise<DynamicFieldGroupRecord> {
    const existing = await tx.selectOne<DynamicFieldGroupRecord>(
      await this.resolveRegistryTableName(),
      {
        where: this.whereEq("slug", data.slug),
      }
    );

    if (existing) {
      // As in registerComponent: generic public message, slug in logContext.
      throw NextlyError.duplicate({
        logContext: { reason: "component-slug-conflict", slug: data.slug },
      });
    }

    const now = this.formatDateForDb();
    // Same contract as registerComponent: the caller resolves the physical name.
    const tableName = data.tableName;
    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      label: data.label,
      table_name: tableName,
      description: data.description,
      fields: JSON.stringify(data.fields),
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      // i18n: persist the localized flag so embedded instances route translatable
      // fields to the companion `comp_<slug>_locales` table.
      localized: data.localized === true ? 1 : 0,
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    const result = await tx.insert<DynamicFieldGroupRecord>(
      await this.resolveRegistryTableName(),
      record,
      { returning: "*" }
    );

    return this.deserializeRecord(result);
  }

  /**
   * Update a Component's metadata.
   *
   * @throws NextlyError(NOT_FOUND) when no Component matches the slug.
   * @throws NextlyError(FORBIDDEN) when the Component is locked and the source isn't "code".
   */
  async updateComponent(
    slug: string,
    data: Partial<DynamicFieldGroupInsert>,
    options?: UpdateComponentOptions
  ): Promise<DynamicFieldGroupRecord> {
    this.logger.debug("Updating Component", { slug });

    const existing = await this.getComponent(slug);

    if (existing.locked && options?.source !== "code") {
      // Generic FORBIDDEN; slug and source go to logContext only.
      throw NextlyError.forbidden({
        logContext: {
          reason: "component-locked",
          slug,
          source: options?.source ?? "UI",
        },
      });
    }

    const updateData = this.buildComponentUpdateColumns(data);

    // 🔴 The version advances when the PHYSICAL SHAPE changes, not when `fields` happens to be
    // present. `schema_version` is an optimistic lock: `assertSchemaVersionMatch` rejects a save
    // whose editor was loaded before someone else changed the schema, so anything that moves
    // storage has to invalidate an in-flight editor.
    //
    // Toggling `localized` moves every translatable column between the main table and
    // `comp_<slug>_locales`. Tying the bump to `fields` alone left that transition invisible to the
    // guard: a preview taken beforehand still matched, and applying it wrote a stale field set over
    // a shape that had already moved. `applyComponentSchemaChanges` bumps after the same physical
    // transition, so this is two paths performing one move and only one of them advancing the lock.
    //
    // Compared against the STORED value rather than merely being present, so a request that resends
    // the current setting does not invalidate every open editor for no reason.
    const localizationChanged =
      data.localized !== undefined &&
      (data.localized === true) !== (existing.localized === true);

    if (
      data.fields ||
      localizationChanged ||
      options?.invalidateSchemaVersion
    ) {
      // One increment however many reasons applied: the row moved to the next version, once.
      updateData.schema_version = existing.schemaVersion + 1;
    }

    try {
      const results = await this.adapter.update<DynamicFieldGroupRecord>(
        await this.resolveRegistryTableName(),
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        // Generic "Not found."; slug in logContext.
        throw NextlyError.notFound({ logContext: { slug } });
      }

      this.logger.info("Component updated", { slug });

      return this.deserializeRecord(results[0]);
    } catch (error) {
      // Preserve already-mapped NextlyErrors (the notFound above, or a
      // forbidden from the locked-check). Anything else is a raw DB error.
      // Normalise raw driver errors first so unique/fk/etc. produce the right kind.
      if (NextlyError.is(error)) {
        throw error;
      }
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * The column writes an update carries, shared by the unconditional and the conditional update.
   *
   * Everything EXCEPT `schema_version`: the two callers derive the version differently — one from
   * the row it just read, one from the version its caller's decision was computed against — and
   * that arithmetic is the whole difference between them, so it stays at the call sites while the
   * column mapping lives once here.
   */
  private buildComponentUpdateColumns(
    data: Partial<DynamicFieldGroupInsert>
  ): Record<string, unknown> {
    const updateData: Record<string, unknown> = {
      updated_at: this.formatDateForDb(),
    };

    if (data.label !== undefined) {
      updateData.label = data.label;
    }

    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    if (data.fields) {
      updateData.fields = JSON.stringify(data.fields);
      updateData.migration_status = data.migrationStatus || "pending";
    } else if (data.migrationStatus !== undefined) {
      // How far a schema change GOT is not a property of the field list, and coupling the two made
      // it unwritable on its own. That left the one caller who has an outcome and nothing else to
      // say — a write that failed after its DDL committed — unable to record it, so a row went on
      // describing a shape the tables no longer have with nothing marking the divergence.
      updateData.migration_status = data.migrationStatus;
    }

    if (data.admin !== undefined) {
      updateData.admin = data.admin ? JSON.stringify(data.admin) : null;
    }

    if (data.schemaHash) {
      updateData.schema_hash = data.schemaHash;
    }

    if (data.locked !== undefined) {
      updateData.locked = data.locked ? 1 : 0;
    }

    // i18n: persist the Internationalization flag on update. Previously omitted, so a component
    // toggled localized in the UI (or a code-first sync flag flip) could never update the column
    // — only registerComponent (create) ever wrote it. Mirrors the collection/single registries.
    if (data.localized !== undefined) {
      updateData.localized = data.localized === true ? 1 : 0;
    }

    if (data.configPath !== undefined) {
      updateData.config_path = data.configPath;
    }

    // Only ever supplied by the legacy-pointer repair, which has verified the
    // derived table exists and the stored one does not.
    if (data.tableName !== undefined) {
      updateData.table_name = data.tableName;
    }

    return updateData;
  }

  /**
   * Update a Component only if its `schema_version` is still the one the caller decided from.
   *
   * A compare-and-set: the WHERE clause carries the expected version, so the DATABASE decides in
   * one statement whether the row still is what the caller believed — there is no read between the
   * decision and the write for another writer, or a transient failure, to slip through. The two
   * callers this exists for both hold a decision computed against a version they read earlier: a
   * divergence marker that must not stamp a row the original write reached after all, and a
   * reconcile whose repair must not overwrite an edit that landed while it was planning.
   *
   * `{ matched: false }` is a THIRD outcome, not an error: the row at that version no longer
   * exists, because it advanced or because it was deleted. The two are indistinguishable without
   * another read — which is exactly the dependency this method removes — and every caller treats
   * them the same way: the decision is stale, do not write, re-derive. It is not squeezed into the
   * NOT_FOUND throw, whose meaning here would be false for the commoner (advanced) case.
   *
   * The version ALWAYS advances, to `expectedSchemaVersion + 1`, computed against the value the
   * WHERE pins rather than a fresh read.
   *
   * 🔴 That advance is also what keeps the matched count trustworthy on MySQL, which counts CHANGED
   * rows rather than matched ones: a matching write always moves `schema_version`, so matched
   * implies changed — see `DrizzleAdapter.updateCount`. `updated_at` moves on every write too and
   * masks the distinction in ordinary use, which is why the version is the one to rely on: it is
   * strictly monotonic, while two writes inside a single timestamp tick carry the SAME `updated_at`
   * and would leave an all-identical payload counting zero. Do not remove either without the other.
   *
   * No returned row, deliberately. On a dialect without RETURNING a returning read re-runs the
   * WHERE — whose version this write just moved past — so a landed write would read back as
   * missing. The caller already knows the whole write it requested; there is nothing a read-back
   * could add except a second query able to fail after the first committed.
   */
  async updateComponentIfVersion(
    slug: string,
    data: Partial<DynamicFieldGroupInsert>,
    expectedSchemaVersion: number,
    options?: UpdateComponentOptions
  ): Promise<{ matched: true; newSchemaVersion: number } | { matched: false }> {
    this.logger.debug("Conditionally updating Component", {
      slug,
      expectedSchemaVersion,
    });

    const existing = await this.getComponent(slug);

    if (existing.locked && options?.source !== "code") {
      // Generic FORBIDDEN; slug and source go to logContext only.
      throw NextlyError.forbidden({
        logContext: {
          reason: "component-locked",
          slug,
          source: options?.source ?? "UI",
        },
      });
    }

    const updateData = this.buildComponentUpdateColumns(data);
    const newSchemaVersion = expectedSchemaVersion + 1;
    updateData.schema_version = newSchemaVersion;

    try {
      const matched = await this.adapter.updateCount(
        await this.resolveRegistryTableName(),
        updateData,
        {
          and: [
            { column: "slug", op: "=", value: slug },
            // 🔴 The Drizzle PROPERTY name, not the database column name. A WHERE clause is
            // resolved against the table object's properties, while the SET payload above is
            // mapped from snake_case by `mapDataToColumnNames` — so the two halves of this one
            // statement legitimately spell the same column differently, and `schema_version` here
            // raises "Column not found" rather than matching nothing.
            {
              column: "schemaVersion",
              op: "=",
              value: expectedSchemaVersion,
            },
            // 🔴 The lock state belongs IN the predicate, not only in the read above. Ownership can
            // change without the version moving — a code sync claiming an existing UI group sets
            // `locked` through the admin-only branch — so a caller that read the row unlocked still
            // satisfies a version-only predicate and overwrites a definition that is now owned by a
            // config file. Pinning it here makes the check and the write one statement, which is
            // the whole reason this method exists rather than a read followed by an update.
            //
            // Only for a non-code caller: `source: "code"` IS the owner, and the read above already
            // permits it, so requiring `locked = false` there would refuse every code sync.
            // Safe as an equality because the column is NOT NULL with a default, so there is no
            // third state for it to miss.
            ...(options?.source !== "code"
              ? [{ column: "locked", op: "=" as const, value: false }]
              : []),
          ],
        }
      );

      if (matched === 0) {
        this.logger.info("Component conditional update did not match", {
          slug,
          expectedSchemaVersion,
        });
        return { matched: false };
      }

      this.logger.info("Component updated", { slug });
      return { matched: true, newSchemaVersion };
    } catch (error) {
      // Preserve already-mapped NextlyErrors; anything else is a raw DB error.
      if (NextlyError.is(error)) {
        throw error;
      }
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Delete a Component from the registry.
   */
  async deleteComponent(slug: string): Promise<void> {
    this.logger.debug("Deleting Component", { slug });

    const existing = await this.getComponent(slug);

    if (existing.locked) {
      // Generic FORBIDDEN — slug-specific reason stays operator-side.
      throw NextlyError.forbidden({
        logContext: { reason: "component-locked-for-delete", slug },
      });
    }

    const references = await this.findComponentReferences(slug);

    if (references.length > 0) {
      // The CONFLICT factory carries a stable generic public message.
      // The structured `references` payload is operator-only — putting it on
      // logContext keeps it out of the wire while preserving full debug info.
      throw NextlyError.conflict({
        reason: "state",
        logContext: { reason: "component-has-references", slug, references },
      });
    }

    try {
      // Tear down the localization artifacts BEFORE the main table: the companion
      // `_locales` table holds an FK to this table's `id`, so dropping the main table
      // first would orphan it (Postgres CASCADE) or fail outright (MySQL). This also
      // purges the component's rows from the shared `nextly_i18n_archive`.
      // A component can host other components. Those nested instances point at THIS
      // table via `_parent_table`, so dropping it below would strand them. Deletion is
      // blocked while anything references this component, but nothing blocks the reverse
      // direction, so the nested rows are this delete's responsibility.
      await teardownEntityComponentData({
        adapter: this.adapter,
        parentTable: existing.tableName,
      });

      await teardownEntityI18n({
        kind: "fieldGroup",
        adapter: this.adapter,
        slug,
        tableName: existing.tableName,
      });

      // Drop the data table after its dependents, since both hold references into it.
      // A failure here leaves the component present but its nested instances, companion
      // table and archived translations already removed — the teardowns above are not
      // reversible. A transaction would not close that window portably: MySQL commits
      // implicitly on DDL, so the drop could not roll back there. Retrying the delete is
      // safe (every step is existence-guarded) and is the intended recovery.
      await this.dropComponentTable(existing.tableName);

      // PG RETURNING-less DELETE always returns 0 rows, so no post-delete count check.
      await this.adapter.delete(
        await this.resolveRegistryTableName(),
        this.whereEq("slug", slug)
      );

      this.logger.info("Component deleted", { slug });
    } catch (error) {
      // Preserve mapped NextlyErrors thrown from the locked / has-references
      // checks above; raw DB errors map via fromDatabaseError. Normalise raw
      // driver errors via toDbError(dialect) first so the kind is preserved.
      if (NextlyError.is(error)) {
        throw error;
      }
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  // Uses IF EXISTS so the operation is safe even if the table was never created.
  // PostgreSQL uses CASCADE to drop any dependent objects.
  private async dropComponentTable(tableName: string): Promise<void> {
    const q = this.dialect === "mysql" ? "`" : '"';
    const quotedName = `${q}${tableName}${q}`;
    const sql =
      this.dialect === "postgresql"
        ? `DROP TABLE IF EXISTS ${quotedName} CASCADE`
        : `DROP TABLE IF EXISTS ${quotedName}`;

    this.logger.debug("Dropping component table", { tableName });
    await this.adapter.executeQuery(sql);
    this.logger.info("Component table dropped", { tableName });
  }

  /**
   * Sync code-first Components with the registry.
   */
  async syncCodeFirstComponents(
    configs: CodeFirstComponentConfig[]
  ): Promise<SyncComponentResult> {
    this.logger.info("Syncing code-first Components", {
      count: configs.length,
    });

    const result: SyncComponentResult = {
      created: [],
      updated: [],
      unchanged: [],
      errors: [],
    };

    for (const config of configs) {
      try {
        const existing = await this.getComponentBySlug(config.slug);
        const schemaHash = calculateSchemaHash(config.fields);
        // Canonical resolution: comp_ + normalized slug, matching what the
        // runtime schema layer and migrate:create derive for the same
        // component. Resolved before the
        // existence check so a stored name that drifted from it is reconciled
        // rather than left addressing a table the schema layer never created.
        const desiredTableName = resolveComponentTableName(config.slug);
        // A component's stored table name is never changed here. Repointing an
        // existing component at different storage moves no data, and the paths
        // that generate DDL do not all have the registry available — the
        // offline migration generator has no database connection at all — so a
        // divergence between the configured name and the stored one cannot be
        // honoured consistently. Moving a registered component to different
        // storage is a migration, not a config edit.
        //
        // Reported rather than passed over: registry-backed reads, filters and
        // teardown all follow the stored name, so a mismatch means they address
        // a table the schema layer is not maintaining. Recording it as a sync
        // error surfaces it on every boot until a migration resolves it.
        let repairedTableName: string | undefined;
        // Any difference is treated the same way, casing included. Derived
        // names are always lowercase, so a stored pointer differing only in
        // case is a legacy or hand-edited row rather than a supported state,
        // and whether two spellings are one table is server configuration that
        // cannot be inferred from the catalog: a single listed spelling means
        // the other does not exist, not that the server folded them.
        if (existing !== null && existing.tableName !== desiredTableName) {
          // One mismatch is repairable without moving anything: the stored name
          // addresses no table while the configured one does. That is a row
          // written before names resolved canonically — the data has always
          // been in the configured table — so correcting the pointer converges
          // the registry onto the config rather than leaving them divergent.
          const [storedExists, desiredExists] = await Promise.all([
            this.adapter.tableExists(existing.tableName),
            this.adapter.tableExists(desiredTableName),
          ]);

          if (!storedExists && desiredExists) {
            repairedTableName = desiredTableName;
            this.logger.warn("Component registry table name repaired", {
              slug: config.slug,
              from: existing.tableName,
              to: desiredTableName,
            });
          } else {
            result.errors.push({
              slug: config.slug,
              error:
                `Registry table '${existing.tableName}' does not match the derived ` +
                `'${desiredTableName}'. Storage is not repointed automatically; run a ` +
                `migration to move the data.`,
            });
            continue;
          }
        }
        if (!existing) {
          await this.registerComponent({
            slug: config.slug,
            label: config.label,
            tableName: desiredTableName,
            description: config.description,
            fields: config.fields,
            admin: config.admin,
            source: "code",
            locked: true,
            localized: config.localized === true,
            configPath: config.configPath,
            schemaHash,
          });
          result.created.push(config.slug);
        } else {
          // 🔴 Clear a `diverged` mark BEFORE deciding what this sync writes, because that state
          // is otherwise a dead end for a code-managed group: the admin refuses it for being
          // locked and this path is refused for being diverged, so neither direction can reach it.
          // The sync is the right caller — it holds the config file, which IS the definition for a
          // locked group — and `fromCode` is what lets the repair past the lock check.
          //
          // Best effort, and deliberately so: the repair describes the row against its tables,
          // while the write below describes it against the config file. If the repair cannot
          // decide (it refuses on genuinely ambiguous tables) the error is RECORDED and the sync
          // continues to the next component, leaving the mark in place rather than failing every
          // remaining component behind one unrepairable row.
          if (existing.migrationStatus === "diverged") {
            try {
              const { reconcileFieldGroup } = await import(
                "./field-group-reconcile-service"
              );
              await reconcileFieldGroup({
                registry: this,
                adapter: this.adapter,
                logger: this.logger,
                slug: config.slug,
                fromCode: true,
              });
              this.logger.info(
                "[FieldGroups] Cleared a diverged mark on a code-managed field group",
                { slug: config.slug }
              );
            } catch (reconcileError) {
              const detail =
                reconcileError instanceof Error
                  ? reconcileError.message
                  : String(reconcileError);
              this.logger.error(
                "[FieldGroups] Could not clear the diverged mark on a code-managed field group",
                { slug: config.slug, error: detail }
              );
              result.errors.push({ slug: config.slug, error: detail });
              continue;
            }
          }
          // 🔴 The row is RE-READ when the repair above rewrote it, because the decision below
          // compares the config against the record and the record is no longer the one in hand.
          // The repair writes fields, hash, localization and version from the LIVE TABLES; the
          // stale copy still describes what the config happens to say, so the comparison reports
          // "unchanged" and no table work is queued — leaving the mark cleared over a registry that
          // describes the tables and a config that describes something else, which is the exact
          // divergence this sync exists to close.
          const settled =
            existing.migrationStatus === "diverged"
              ? await this.getComponent(config.slug)
              : existing;

          await this.syncExistingCodeFirstComponent({
            config,
            existing: settled,
            schemaHash,
            repairedTableName,
            result,
          });
        }
      } catch (error) {
        result.errors.push({
          slug: config.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info("Code-first Component sync complete", {
      created: result.created.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Write the config file's definition onto a component the registry already holds.
   *
   * Extracted so the divergence repair above reads as one step rather than being buried in the
   * branch it guards; the decision of WHAT to write is unchanged.
   */
  private async syncExistingCodeFirstComponent(args: {
    config: CodeFirstComponentConfig;
    existing: DynamicFieldGroupRecord;
    schemaHash: string;
    repairedTableName: string | undefined;
    result: SyncComponentResult;
  }): Promise<void> {
    const { config, existing, schemaHash, repairedTableName, result } = args;
    if (
      repairedTableName !== undefined ||
      !schemaHashesMatch(schemaHash, existing.schemaHash) ||
      (config.localized === true) !== (existing.localized === true)
    ) {
      await this.updateComponent(
        config.slug,
        {
          label: config.label,
          description: config.description,
          fields: config.fields,
          admin: config.admin,
          configPath: config.configPath,
          schemaHash,
          locked: true,
          localized: config.localized === true,
          tableName: repairedTableName,
        },
        { source: "code" }
      );
      result.updated.push(config.slug);
    } else if (this.adminConfigChanged(config.admin, existing.admin)) {
      await this.updateComponent(
        config.slug,
        {
          admin: config.admin,
          locked: true,
        },
        { source: "code" }
      );
      result.updated.push(config.slug);
    } else {
      result.unchanged.push(config.slug);
    }
  }

  /**
   * Find all references to a Component across Collections, Singles, and other Components.
   */
  async findComponentReferences(
    componentSlug: string
  ): Promise<ComponentReference[]> {
    this.logger.debug("Checking for component references", {
      slug: componentSlug,
    });

    const references: ComponentReference[] = [];

    try {
      const collections = await this.adapter.select<Record<string, unknown>>(
        "dynamic_collections",
        { columns: ["slug", "fields"] }
      );

      for (const collection of collections) {
        const slug = collection.slug as string;
        const fields = this.parseJsonField(collection.fields);
        if (fields) {
          const found = this.scanFieldsForComponentRef(
            fields,
            componentSlug,
            slug,
            "collection"
          );
          references.push(...found);
        }
      }
    } catch (error) {
      // Table may not exist yet (fresh install) — not an error.
      this.logger.debug("Could not scan dynamic_collections for references", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const singles = await this.adapter.select<Record<string, unknown>>(
        "dynamic_singles",
        { columns: ["slug", "fields"] }
      );

      for (const single of singles) {
        const slug = single.slug as string;
        const fields = this.parseJsonField(single.fields);
        if (fields) {
          const found = this.scanFieldsForComponentRef(
            fields,
            componentSlug,
            slug,
            "single"
          );
          references.push(...found);
        }
      }
    } catch (error) {
      this.logger.debug("Could not scan dynamic_singles for references", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Declared out here so the failure log can name it, ASSIGNED inside the
    // try so a failed resolution is contained like any other read failure.
    // This scan is best effort — it informs a reference check, and a catalog
    // hiccup must not turn that into a hard failure — so the resolution has to
    // sit inside the same boundary as the read it feeds. Its initial value is
    // the name this release's DDL creates, which is what the message should say
    // when resolution itself is what failed.
    let registryTable: string = STORAGE_FORMAT.registryTable;
    try {
      registryTable = await this.resolveRegistryTableName();
      const components = await this.adapter.select<Record<string, unknown>>(
        registryTable,
        { columns: ["slug", "fields"] }
      );

      for (const comp of components) {
        const slug = comp.slug as string;
        if (slug === componentSlug) {
          continue;
        }
        const fields = this.parseJsonField(comp.fields);
        if (fields) {
          const found = this.scanFieldsForComponentRef(
            fields,
            componentSlug,
            slug,
            "component"
          );
          references.push(...found);
        }
      }
    } catch (error) {
      this.logger.debug(`Could not scan ${registryTable} for references`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (references.length > 0) {
      this.logger.debug("Found component references", {
        slug: componentSlug,
        count: references.length,
        references: references.map(
          r => `${r.entityType}:${r.entitySlug}.${r.fieldPath}`
        ),
      });
    }

    return references;
  }

  /**
   * Enrich field configurations with inline component schemas.
   */
  async enrichFieldsWithComponentSchemas(
    fields: Record<string, unknown>[],
    currentDepth = 0
  ): Promise<EnrichedFieldConfig[]> {
    const slugs = this.collectComponentSlugs(fields);

    if (slugs.size === 0) {
      return fields;
    }

    const componentMap = await this.fetchComponentsBySlugsBatch([...slugs]);

    return this.enrichFieldsRecursive(fields, componentMap, currentDepth);
  }

  private collectComponentSlugs(
    fields: Record<string, unknown>[],
    slugs = new Set<string>()
  ): Set<string> {
    for (const field of fields) {
      const fieldType = field.type as string;

      // The slugs come from the shared reader so a definition referencing its
      // field group through either key spelling is collected the same way.
      if (isFieldGroupType(fieldType)) {
        const { single, many } = extractFieldGroupReferences(field);
        if (single) {
          slugs.add(single);
        }
        if (many) {
          for (const slug of many) {
            slugs.add(slug);
          }
        }
      }

      const nestedFields = field.fields as
        | Record<string, unknown>[]
        | undefined;
      if (Array.isArray(nestedFields)) {
        this.collectComponentSlugs(nestedFields, slugs);
      }
    }

    return slugs;
  }

  private async fetchComponentsBySlugsBatch(
    slugs: string[]
  ): Promise<Map<string, DynamicFieldGroupRecord>> {
    const componentMap = new Map<string, DynamicFieldGroupRecord>();

    if (slugs.length === 0) {
      return componentMap;
    }

    try {
      const results = await this.adapter.select<DynamicFieldGroupRecord>(
        await this.resolveRegistryTableName(),
        {
          where: {
            and: [
              {
                column: "slug",
                op: "IN",
                value: slugs,
              },
            ],
          },
        }
      );

      for (const result of results) {
        const deserialized = this.deserializeRecord(result);
        componentMap.set(deserialized.slug, deserialized);
      }
    } catch (error) {
      this.logger.error(
        "[ComponentRegistry.fetchComponentsBySlugsBatch] Database error",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    return componentMap;
  }

  private async enrichFieldsRecursive(
    fields: Record<string, unknown>[],
    componentMap: Map<string, DynamicFieldGroupRecord>,
    currentDepth: number
  ): Promise<EnrichedFieldConfig[]> {
    const enrichedFields: EnrichedFieldConfig[] = [];

    for (const field of fields) {
      const fieldType = field.type as string;
      const enrichedField: EnrichedFieldConfig = { ...field };

      if (isFieldGroupType(fieldType)) {
        const { single: componentSlug, many: componentsArray } =
          extractFieldGroupReferences(field);
        if (componentSlug) {
          const component = componentMap.get(componentSlug);
          if (component) {
            let componentFields = component.fields as unknown as Record<
              string,
              unknown
            >[];
            if (
              currentDepth < MAX_FIELD_GROUP_NESTING_DEPTH &&
              Array.isArray(componentFields)
            ) {
              const nestedSlugs = this.collectComponentSlugs(componentFields);
              if (nestedSlugs.size > 0) {
                const missingSlugsFetch = [...nestedSlugs].filter(
                  s => !componentMap.has(s)
                );
                if (missingSlugsFetch.length > 0) {
                  const nestedMap =
                    await this.fetchComponentsBySlugsBatch(missingSlugsFetch);
                  for (const [slug, record] of nestedMap) {
                    componentMap.set(slug, record);
                  }
                }
                componentFields = await this.enrichFieldsRecursive(
                  componentFields,
                  componentMap,
                  currentDepth + 1
                );
              }
            }
            enrichedField.componentFields = componentFields;
          }
        }

        if (componentsArray && componentsArray.length > 0) {
          const componentSchemas: Record<string, EnrichedComponentSchema> = {};

          for (const slug of componentsArray) {
            const component = componentMap.get(slug);
            if (component) {
              let componentFields = component.fields as unknown as Record<
                string,
                unknown
              >[];
              if (
                currentDepth < MAX_FIELD_GROUP_NESTING_DEPTH &&
                Array.isArray(componentFields)
              ) {
                const nestedSlugs = this.collectComponentSlugs(componentFields);
                if (nestedSlugs.size > 0) {
                  const missingSlugsFetch = [...nestedSlugs].filter(
                    s => !componentMap.has(s)
                  );
                  if (missingSlugsFetch.length > 0) {
                    const nestedMap =
                      await this.fetchComponentsBySlugsBatch(missingSlugsFetch);
                    for (const [s, record] of nestedMap) {
                      componentMap.set(s, record);
                    }
                  }
                  componentFields = await this.enrichFieldsRecursive(
                    componentFields,
                    componentMap,
                    currentDepth + 1
                  );
                }
              }

              componentSchemas[slug] = {
                label: component.label,
                fields: componentFields,
                admin: component.admin,
              };
            }
          }

          if (Object.keys(componentSchemas).length > 0) {
            enrichedField.componentSchemas = componentSchemas;
          }
        }
      }

      const nestedFields = field.fields as
        | Record<string, unknown>[]
        | undefined;
      if (Array.isArray(nestedFields)) {
        enrichedField.fields = await this.enrichFieldsRecursive(
          nestedFields,
          componentMap,
          currentDepth
        );
      }

      enrichedFields.push(enrichedField);
    }

    return enrichedFields;
  }

  private parseJsonField(value: unknown): Record<string, unknown>[] | null {
    if (!value) {
      return null;
    }
    try {
      if (typeof value === "string") {
        return JSON.parse(value);
      }
      if (Array.isArray(value)) {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }

  private scanFieldsForComponentRef(
    fields: Record<string, unknown>[],
    targetSlug: string,
    entitySlug: string,
    entityType: ComponentReference["entityType"],
    parentPath = ""
  ): ComponentReference[] {
    const references: ComponentReference[] = [];

    for (const field of fields) {
      const fieldName = field.name as string;
      if (!fieldName) {
        continue;
      }

      const fieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
      const fieldType = field.type as string;

      if (isFieldGroupType(fieldType)) {
        const { single, many } = extractFieldGroupReferences(field);
        if (single === targetSlug) {
          references.push({ entityType, entitySlug, fieldName, fieldPath });
        }

        if (many && many.includes(targetSlug)) {
          references.push({ entityType, entitySlug, fieldName, fieldPath });
        }
      }

      if (
        (fieldType === "repeater" || fieldType === "group") &&
        Array.isArray(field.fields)
      ) {
        const nested = this.scanFieldsForComponentRef(
          field.fields as Record<string, unknown>[],
          targetSlug,
          entitySlug,
          entityType,
          fieldPath
        );
        references.push(...nested);
      }
    }

    return references;
  }

  protected deserializeRecord(
    record: DynamicFieldGroupRecord | Record<string, unknown>
  ): DynamicFieldGroupRecord {
    const r = record as Record<string, unknown>;
    const fields = r.fields as string | object;
    const admin = r.admin as string | object | null;
    const tableName = (r.table_name || r.tableName) as string;
    const configPath = (r.config_path || r.configPath) as string | undefined;
    const schemaHash = (r.schema_hash || r.schemaHash) as string;
    const schemaVersion = (r.schema_version || r.schemaVersion) as number;
    const migrationStatus = (r.migration_status || r.migrationStatus) as string;
    const lastMigrationId = (r.last_migration_id || r.lastMigrationId) as
      | string
      | undefined;
    const createdBy = (r.created_by || r.createdBy) as string | undefined;
    const createdAt = (r.created_at || r.createdAt) as Date | string | number;
    const updatedAt = (r.updated_at || r.updatedAt) as Date | string | number;

    return {
      id: r.id as string,
      slug: r.slug as string,
      label: r.label as string,
      tableName,
      description: r.description as string | undefined,
      fields:
        typeof fields === "string"
          ? (JSON.parse(fields) as DynamicFieldGroupRecord["fields"])
          : (fields as DynamicFieldGroupRecord["fields"]),
      admin: admin
        ? typeof admin === "string"
          ? (JSON.parse(admin) as FieldGroupAdminOptions)
          : admin
        : undefined,
      source: r.source as FieldGroupSource,
      locked: Boolean(r.locked),
      localized: Boolean(r.localized),
      configPath,
      schemaHash,
      schemaVersion,
      migrationStatus: migrationStatus as FieldGroupMigrationStatus,
      lastMigrationId,
      createdBy,
      createdAt: this.normalizeDbTimestamp(createdAt) as unknown as Date,
      updatedAt: this.normalizeDbTimestamp(updatedAt) as unknown as Date,
    };
  }
}
