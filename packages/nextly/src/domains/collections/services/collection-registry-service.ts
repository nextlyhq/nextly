/**
 * Collection Registry Service
 *
 * Manages the `dynamic_collections` metadata table for both code-first
 * and UI-created collections. Provides schema hash-based change detection
 * for code-first collection syncing.
 *
 * Extends BaseRegistryService for shared CRUD, migration tracking, and utility patterns.
 *
 * @module services/collections/collection-registry-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { toDbError } from "../../../database/errors";
// PR 4 migration: replaced legacy ServiceError throws with the unified
// NextlyError API. Public messages follow §13.8 — generic, no identifiers,
// no constraint hints — and identifying detail moves to logContext.
import type { PermissionSeedService } from "../../../domains/auth/services/permission-seed-service";
import { NextlyError, describeError, immediateMessage } from "../../../errors";
import type {
  DynamicCollectionInsert,
  DynamicCollectionRecord,
  MigrationStatus,
  CollectionSource,
} from "../../../schemas/dynamic-collections/types";
import { assertGlobalResourceSlugAvailable } from "../../../services/lib/resource-slug-guard";
import type { Logger } from "../../../services/shared";
import { BaseRegistryService } from "../../../shared/base-registry-service";
import type {
  BaseListOptions,
  BaseListResult,
} from "../../../shared/base-registry-service";
import { fieldDefaultsSignature } from "../../../shared/lib/field-defaults";
import {
  calculateSchemaHash,
  schemaHashesMatch,
} from "../../schema/services/schema-hash";
import { VersionsRepository } from "../../versions/versions-repository";
import {
  clearWebhookRecording,
  setWebhookRecording,
} from "../../webhooks/recording-policy";
import { isConfigOwnedSource } from "../../webhooks/recording-provenance";

import { resolveDescription } from "./collection-sync-service";

/** Options for updating a collection. */
export interface UpdateCollectionOptions {
  /** Source making the update. Used to enforce locking rules. */
  source?: CollectionSource;
}

/** Input for registering a code-first collection during sync. */
export interface CodeFirstCollectionConfig {
  slug: string;
  labels: { singular: string; plural: string };
  fields: DynamicCollectionInsert["fields"];
  description?: string;
  tableName?: string;
  timestamps?: boolean;
  /** Whether the collection has the Draft/Published status feature enabled. */
  status?: boolean;
  /** Resolved content-versioning config (or null when unversioned). */
  versions?: DynamicCollectionInsert["versions"];
  /** Cache-revalidation config (or null when the collection sets none). */
  revalidate?: DynamicCollectionInsert["revalidate"];
  /** Webhook recording policy (or null when the collection records, the default). */
  webhooks?: DynamicCollectionInsert["webhooks"];
  /** Whether collection-level i18n is enabled (mirrors `status`). */
  localized?: boolean;
  admin?: DynamicCollectionInsert["admin"];
  configPath?: string;
  /**
   * Provenance (D14): `"code"` for app code-first collections, `"plugin:<name>"`
   * for plugin-contributed ones. Defaults to `"code"` when omitted.
   */
  source?: CollectionSource;
}

/** Result of syncing code-first collections. */
export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  errors: Array<{ slug: string; error: string }>;
}

/**
 * Pipeline-managed sources (D14): app code-first (`code`) and plugin-contributed
 * (`plugin:<name>`). These are locked-by-default and may be updated by the boot
 * pipeline even when locked — unlike Builder (`ui`) entities, which are edited
 * through the admin and protected by the optimistic lock.
 */
function isPipelineSource(source: CollectionSource | undefined): boolean {
  return source === "code" || (!!source && source.startsWith("plugin:"));
}

/** Options for listing collections. */
export interface ListCollectionsOptions extends BaseListOptions {
  source?: CollectionSource;
  migrationStatus?: MigrationStatus;
}

/**
 * Result of listing collections with pagination info.
 *
 * Declared as a `type` alias rather than an empty `interface` because the latter
 * triggers @typescript-eslint/no-empty-object-type. We intentionally keep this
 * named export so callers can import a domain-specific name even though it has
 * no extra members today.
 */
export type ListCollectionsResult = BaseListResult<DynamicCollectionRecord>;

export class CollectionRegistryService extends BaseRegistryService<
  DynamicCollectionRecord,
  MigrationStatus
> {
  protected readonly registryTableName = "dynamic_collections";
  protected readonly resourceType = "Collection";
  protected readonly tableNamePrefix = "dc_";

  private permissionSeedService?: PermissionSeedService;
  /** Invoked when code-first sync resolves a new `tableName` for an existing slug. */
  private onTableNameChanged?: (slug: string) => void;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  protected getSearchColumns(): string[] {
    return ["slug"];
  }

  /** Set the PermissionSeedService for auto-seeding permissions on collection sync. */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.permissionSeedService = service;
  }

  /** Register a callback fired when sync resolves a new `tableName` for a slug. */
  setOnTableNameChanged(callback: (slug: string) => void): void {
    this.onTableNameChanged = callback;
  }

  async getCollectionBySlug(
    slug: string,
    // Optional transaction-bound executor so the lookup runs on the caller's
    // transaction connection instead of taking a second pooled one.
    executor?: unknown
  ): Promise<DynamicCollectionRecord | null> {
    return this.getRecordBySlug(slug, executor);
  }

  async getCollection(slug: string): Promise<DynamicCollectionRecord> {
    return this.getRecordOrThrow(slug);
  }

  async getAllCollections(
    options?: ListCollectionsOptions
  ): Promise<DynamicCollectionRecord[]> {
    return this.getAllRecords(options);
  }

  /**
   * Find pipeline-managed collections (code/plugin) that are no longer in the
   * current config — orphans left after a plugin or code collection was removed
   * (D14). They are RETAINED (never auto-dropped); `nextly prune` drops them
   * explicitly. Builder (`ui`) collections are excluded — they are managed via
   * the Visual Schema Builder, not the code config.
   */
  async findOrphanedCollections(
    currentSlugs: string[]
  ): Promise<DynamicCollectionRecord[]> {
    const current = new Set(currentSlugs);
    const all = await this.getAllCollections();
    return all.filter(r => isPipelineSource(r.source) && !current.has(r.slug));
  }

  async listCollections(
    options?: ListCollectionsOptions
  ): Promise<ListCollectionsResult> {
    return this.listRecords(options);
  }

  async isLocked(slug: string): Promise<boolean> {
    return this.checkIsLocked(slug);
  }

  async updateMigrationStatus(
    slug: string,
    status: MigrationStatus,
    migrationId?: string
  ): Promise<void> {
    return this.updateRecordMigrationStatus(slug, status, migrationId);
  }

  async updateMigrationStatusWithVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: MigrationStatus }> {
    return this.updateMigrationStatusWithTableVerification(slug, tableName);
  }

  async getPendingMigrations(): Promise<DynamicCollectionRecord[]> {
    return this.getRecordsWithPendingMigrations();
  }

  async registerCollection(
    data: DynamicCollectionInsert
  ): Promise<DynamicCollectionRecord> {
    this.logger.debug("Registering collection", { slug: data.slug });

    await assertGlobalResourceSlugAvailable(this.adapter, data.slug);

    const existing = await this.getCollectionBySlug(data.slug);
    if (existing) {
      // Generic "Resource already exists." from the factory; the slug moves
      // to logContext (operator only, never wire-bound) per §13.8.
      throw NextlyError.duplicate({
        logContext: { reason: "collection-slug-conflict", slug: data.slug },
      });
    }

    const now = this.formatDateForDb();
    const tableName = this.ensureTableNamePrefix(data.tableName);
    const fieldsJson = JSON.stringify(data.fields);
    const schemaHash = data.schemaHash ?? this.computeSimpleHash(fieldsJson);

    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      labels: JSON.stringify(data.labels),
      table_name: tableName,
      description: data.description ?? undefined,
      fields: fieldsJson,
      timestamps: (data.timestamps ?? true) ? 1 : 0,
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? isPipelineSource(data.source)) ? 1 : 0,
      // Persist Draft/Published flag. Stored as 0/1 to match how
      // `timestamps` and `locked` are written in this code path; the
      // SQLite/postgres/mysql Drizzle column types accept either form.
      status: data.status === true ? 1 : 0,
      // Persist the resolved versioning config as JSON (or null), the same way
      // `admin`/`hooks` are written on this raw-insert path.
      versions: data.versions ? JSON.stringify(data.versions) : null,
      // Persist the cache-revalidation config as JSON (or null), like `versions`.
      revalidate: data.revalidate ? JSON.stringify(data.revalidate) : null,
      // Persist the webhook recording policy as JSON (or null), like `revalidate`.
      webhooks: data.webhooks ? JSON.stringify(data.webhooks) : null,
      localized: data.localized === true ? 1 : 0,
      config_path: data.configPath,
      schema_hash: schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      hooks: data.hooks ? JSON.stringify(data.hooks) : null,
      created_at: now,
      updated_at: now,
    };

    try {
      const result = await this.adapter.insert<DynamicCollectionRecord>(
        this.registryTableName,
        record,
        { returning: "*" }
      );

      // Publish the decision into the live policy as well as the column. The
      // boot-time read only runs at startup, so without this a Builder-created
      // collection would keep recording until the next restart — the window in
      // which its content is most likely to be created. Code-first entities are
      // skipped: their config is the source of truth and is already published.
      if (!isConfigOwnedSource(data.source)) {
        setWebhookRecording(
          "collection",
          data.slug,
          data.webhooks?.record !== false,
          "db"
        );
      }

      this.logger.info("Collection registered", {
        slug: data.slug,
        source: data.source,
      });

      const deserializedRecord = this.deserializeRecord(result);

      if (this.permissionSeedService && data.slug) {
        try {
          const permResult =
            await this.permissionSeedService.seedCollectionPermissions(
              data.slug
            );
          if (permResult.newPermissionIds?.length > 0) {
            await this.permissionSeedService.assignNewPermissionsToSuperAdmin(
              permResult.newPermissionIds
            );
          }
          this.logger.info("Collection permissions seeded", {
            slug: data.slug,
            created: permResult.created,
            total: permResult.total,
          });
        } catch (permError) {
          this.logger.error("Failed to seed collection permissions", {
            slug: data.slug,
            error: String(permError),
          });
        }
      }

      return deserializedRecord;
    } catch (error) {
      // Re-throw NextlyErrors unchanged (e.g. our duplicate throw above).
      // Map raw DB errors via fromDatabaseError; generic public message,
      // rich logContext. Normalise raw driver errors via toDbError(dialect)
      // first so unique/fk/etc. produce the right kind.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  async updateCollection(
    slug: string,
    data: Partial<DynamicCollectionInsert>,
    options?: UpdateCollectionOptions
  ): Promise<DynamicCollectionRecord> {
    this.logger.debug("Updating collection", { slug });

    const existing = await this.getCollection(slug);

    const targetSlug = data.slug ?? slug;
    await assertGlobalResourceSlugAvailable(this.adapter, targetSlug, {
      currentResourceType: "collection",
      currentResourceId: existing.id,
    });

    if (existing.locked && !isPipelineSource(options?.source)) {
      // Generic forbidden message per §13.8; lock policy detail and slug
      // move to logContext only.
      throw NextlyError.forbidden({
        logContext: {
          reason: "collection-locked",
          slug,
          source: options?.source,
        },
      });
    }

    const updateData: Record<string, unknown> = {
      updated_at: this.formatDateForDb(),
    };

    if (data.labels) {
      updateData.labels = JSON.stringify(data.labels);
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.fields) {
      updateData.fields = JSON.stringify(data.fields);
      // Bump schema_version + re-flag pending migration only on a PHYSICAL
      // schema change: fields (by hash), or a status / localized toggle (which
      // add/remove the status column or the companion localization schema). A
      // pure-metadata sync (versions/labels/admin) re-sends unchanged fields and
      // must not force a spurious pending-migration cycle. Without a hash we
      // cannot compare fields, so fall back to the prior always-bump behavior.
      const fieldsActuallyChanged =
        data.schemaHash === undefined ||
        !schemaHashesMatch(data.schemaHash, existing.schemaHash);
      const statusToggled =
        data.status !== undefined &&
        (data.status === true) !== (existing.status === true);
      const localizedToggled =
        data.localized !== undefined &&
        (data.localized === true) !== (existing.localized === true);
      if (fieldsActuallyChanged || statusToggled || localizedToggled) {
        updateData.schema_version = existing.schemaVersion + 1;
        updateData.migration_status = "pending";
      }
    }
    if (data.timestamps !== undefined) {
      updateData.timestamps = data.timestamps;
    }
    if (data.admin !== undefined) {
      updateData.admin = data.admin ? JSON.stringify(data.admin) : null;
    }
    if (data.schemaHash) {
      updateData.schema_hash = data.schemaHash;
    }
    if (data.locked !== undefined) {
      updateData.locked = data.locked;
    }
    if (data.configPath !== undefined) {
      updateData.config_path = data.configPath;
    }
    if (data.hooks !== undefined) {
      updateData.hooks = data.hooks ? JSON.stringify(data.hooks) : null;
    }
    // Status toggle: when explicitly defined, write the new value; when
    // undefined, leave the column unchanged. Stored as 0/1 to match how
    // `timestamps` and `locked` are written elsewhere in this service.
    if (data.status !== undefined) {
      updateData.status = data.status === true ? 1 : 0;
    }
    // Versioning config: when explicitly provided (including null to disable),
    // write the resolved JSON; when undefined, leave the column unchanged.
    if (data.versions !== undefined) {
      updateData.versions = data.versions
        ? JSON.stringify(data.versions)
        : null;
    }
    // Cache-revalidation config: same explicit-provide semantics as `versions`.
    if (data.revalidate !== undefined) {
      updateData.revalidate = data.revalidate
        ? JSON.stringify(data.revalidate)
        : null;
    }
    // Webhook recording policy: same explicit-provide semantics as `revalidate`.
    if (data.webhooks !== undefined) {
      updateData.webhooks = data.webhooks
        ? JSON.stringify(data.webhooks)
        : null;
    }
    if (data.localized !== undefined) {
      updateData.localized = data.localized === true ? 1 : 0;
    }
    // Writeable so code-first sync can reconcile a changed `dbName`.
    if (data.tableName !== undefined) {
      updateData.table_name = this.ensureTableNamePrefix(data.tableName);
    }

    try {
      const results = await this.adapter.update<DynamicCollectionRecord>(
        this.registryTableName,
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        // Generic "Not found." from the factory; slug moves to logContext.
        throw NextlyError.notFound({ logContext: { slug } });
      }

      // Mirror the stored change into the live policy so turning the switch
      // off takes effect on the next write, not the next restart. Keyed on the
      // slug the row is actually stored under: this method validates a
      // `data.slug` rename but never writes it, so keying on the requested new
      // slug would publish under a name nothing reads and clear the only entry
      // that matters.
      if (
        data.webhooks !== undefined &&
        !isConfigOwnedSource(options?.source)
      ) {
        setWebhookRecording(
          "collection",
          slug,
          data.webhooks?.record !== false,
          "db"
        );
      }

      this.logger.info("Collection updated", { slug });

      return this.deserializeRecord(results[0]);
    } catch (error) {
      if (NextlyError.is(error)) {
        throw error;
      }
      // Normalise raw driver errors so unique/fk/etc. produce the right kind.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  async deleteCollection(
    slug: string,
    options?: { force?: boolean }
  ): Promise<void> {
    this.logger.debug("Deleting collection", { slug });

    const existing = await this.getCollection(slug);

    if (existing.locked && !options?.force) {
      // Generic forbidden message; lock policy detail goes to logContext.
      // `force` is the explicit, authorized drop path (e.g. `nextly prune`).
      throw NextlyError.forbidden({
        logContext: { reason: "collection-locked-delete", slug },
      });
    }

    try {
      // Recovery points go with the collection, in the SAME transaction as the
      // registry row. Ordering alone was not enough: sweeping first and then
      // failing to delete the collection destroys unsaved work belonging to a
      // collection that still exists, and sweeping afterwards can orphan rows
      // nothing else collects. Only atomicity avoids both, and it is available
      // here because this service talks to the adapter directly.
      //
      // Swept HERE rather than in the metadata service because this is the
      // method every deletion path reaches: the schema route, `db-sync-promote`
      // and `prune` all call it directly, so a sweep one level up would cover
      // one caller and miss three.
      //
      // Durable history and working drafts are deliberately NOT touched: what
      // a deletion owes a document's recorded past is a wider question, and
      // answering it as a side effect here would decide it by accident.
      const count = await this.adapter.transaction(async tx => {
        await new VersionsRepository(tx).deleteAutosavesForEntity(
          "collection",
          slug
        );
        return tx.delete(this.registryTableName, this.whereEq("slug", slug));
      });

      if (count === 0) {
        throw NextlyError.notFound({ logContext: { slug } });
      }

      // Drop the in-process recording decision with the row: a later
      // collection created under this slug must start from the recording
      // default rather than inherit a suppression whose row no longer exists.
      clearWebhookRecording("collection", slug);

      this.logger.info("Collection deleted", { slug });
    } catch (error) {
      if (NextlyError.is(error)) {
        throw error;
      }
      // Normalise raw driver errors so fk/etc. produce the right kind.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  async syncCodeFirstCollections(
    configs: CodeFirstCollectionConfig[]
  ): Promise<SyncResult> {
    this.logger.info("Syncing code-first collections", {
      count: configs.length,
    });

    const result: SyncResult = {
      created: [],
      updated: [],
      unchanged: [],
      errors: [],
    };

    for (const config of configs) {
      try {
        const existing = await this.getCollectionBySlug(config.slug);
        const schemaHash = calculateSchemaHash(config.fields);
        const desiredTableName = config.tableName
          ? this.ensureTableNamePrefix(config.tableName)
          : this.generateTableName(config.slug);

        if (!existing) {
          await this.registerCollection({
            slug: config.slug,
            labels: config.labels,
            tableName: desiredTableName,
            description: config.description,
            fields: config.fields,
            timestamps: config.timestamps ?? true,
            admin: config.admin,
            source: config.source ?? "code",
            locked: true,
            // Forward Draft/Published flag so code-first collections that
            // opt in actually write the column on first sync.
            status: config.status === true,
            // Forward the resolved versioning config on first sync.
            versions: config.versions,
            // Forward the cache-revalidation config on first sync.
            revalidate: config.revalidate,
            // Forward the webhook recording policy on first sync.
            webhooks: config.webhooks,
            localized: config.localized === true,
            configPath: config.configPath,
            schemaHash,
          });
          result.created.push(config.slug);
          await this.seedPermissionsForCollection(config.slug);
        } else if (
          this.schemaSyncNeeded(
            config,
            existing,
            !schemaHashesMatch(schemaHash, existing.schemaHash)
          ) ||
          // Declared defaults are read from the stored definitions when an
          // entry is created, and the schema hash omits them, so they need
          // their own comparison or a changed default never reaches the write.
          fieldDefaultsSignature(config.fields) !==
            fieldDefaultsSignature(existing.fields) ||
          // A collection's physical table, which a Single has no equivalent of.
          desiredTableName !== existing.tableName
        ) {
          // Fields changed, status toggle flipped, or `dbName` resolved to a
          // new physical table — all three need to be written through.
          if (desiredTableName !== existing.tableName) {
            await this.renamePhysicalTable(
              existing.tableName,
              desiredTableName,
              config.slug
            );
            this.onTableNameChanged?.(config.slug);
          }
          await this.updateCollection(
            config.slug,
            {
              labels: config.labels,
              description: resolveDescription(config) ?? null,
              fields: config.fields,
              timestamps: config.timestamps,
              // Explicit null when the config no longer declares an admin block, matching the
              // metadata-only branch below. Removing `admin` usually accompanies some other
              // edit, and that edit selects THIS branch — so without it the common case is the
              // one where stale placement survives.
              admin: config.admin ?? null,
              configPath: config.configPath,
              schemaHash,
              locked: true,
              status: config.status === true,
              versions: config.versions,
              // Send explicit null (not undefined) when the config removed
              // `revalidate`, so updateCollection actually clears the column
              // instead of leaving the stale config persisted.
              revalidate: config.revalidate ?? null,
              // Send explicit null (not undefined) when the config removed
              // `webhooks`, so updateCollection actually clears the column
              // instead of leaving a stale opt-out suppressing the outbox.
              webhooks: config.webhooks ?? null,
              localized: config.localized === true,
              tableName: desiredTableName,
            },
            { source: config.source ?? "code" }
          );
          result.updated.push(config.slug);
          await this.seedPermissionsForCollection(config.slug);
        } else if (
          this.adminConfigChanged(config.admin, existing.admin) ||
          this.labelsChanged(config.labels, existing.labels) ||
          resolveDescription(config) !== (existing.description ?? undefined)
        ) {
          await this.updateCollection(
            config.slug,
            {
              labels: config.labels,
              // Resolved, because a collection may spell its description under `admin` — and
              // compared above for the same reason: without it, editing or removing that
              // spelling leaves the row stale until some unrelated schema change happens to
              // trigger a write.
              description: resolveDescription(config) ?? null,
              // Explicit null when the config no longer declares an admin block, so
              // `updateCollection` clears the column instead of reading `undefined` as "leave
              // unchanged" and stranding a sidebar position the config has dropped. Same
              // reasoning as `revalidate` and `webhooks` above.
              admin: config.admin ?? null,
              locked: true,
            },
            { source: config.source ?? "code" }
          );
          result.updated.push(config.slug);
        } else {
          await this.seedPermissionsForCollection(config.slug);
          result.unchanged.push(config.slug);
        }
      } catch (error) {
        // For NextlyError, the public `message` is a generic string like
        // "An unexpected error occurred." that hides the actual SQL or
        // constraint failure. Pull the structured details (cause +
        // logContext) so the recorded `error` field surfaces enough
        // signal for a contributor to fix the issue without rerunning
        // with a debugger. Fall back to plain `error.message` for
        // non-NextlyError throws.
        const message = describeError(error);
        // Classify on the thrown error's own message: a description
        // concatenates the cause chain, so a genuine failure that merely
        // wraps something saying "already exists" would enter duplicate
        // recovery and mask the real error.
        const immediate = immediateMessage(error).toLowerCase();
        // Prefer the structured NextlyError code over message string matching.
        // Falls back to legacy substring sniffing for any non-NextlyError that
        // bubbles up from deeper layers during the migration window.
        const isDuplicate =
          (NextlyError.is(error) && error.code === "DUPLICATE") ||
          immediate.includes("already exists") ||
          immediate.includes("duplicate") ||
          immediate.includes("unique constraint");
        if (isDuplicate) {
          const refetched = await this.getCollectionBySlug(config.slug).catch(
            () => null
          );
          if (refetched) {
            this.logger.warn(
              `Code-first sync: "${config.slug}" already in DB — treating as unchanged`,
              { slug: config.slug }
            );
            result.unchanged.push(config.slug);
          } else {
            const disambiguatedTableName = `dc_${config.slug.replace(/-/g, "_")}_cf`;
            try {
              const retrySchemaHash = calculateSchemaHash(config.fields);
              await this.registerCollection({
                slug: config.slug,
                labels: config.labels,
                tableName: disambiguatedTableName,
                description: config.description,
                fields: config.fields,
                timestamps: config.timestamps ?? true,
                admin: config.admin,
                source: config.source ?? "code",
                locked: true,
                status: config.status === true,
                // Forward the i18n flag on the table_name-conflict recovery path
                // too (parity with the primary register + update branches), so a
                // collection recovered here does not silently lose localization.
                localized: config.localized === true,
                versions: config.versions,
                revalidate: config.revalidate,
                webhooks: config.webhooks,
                configPath: config.configPath,
                schemaHash: retrySchemaHash,
              });
              this.logger.warn(
                `Code-first sync: "${config.slug}" had table_name conflict — registered with table "${disambiguatedTableName}"`,
                { slug: config.slug, tableName: disambiguatedTableName }
              );
              result.created.push(config.slug);
            } catch (retryError) {
              const retryMessage = describeError(retryError);
              result.errors.push({
                slug: config.slug,
                error: `table_name conflict (tried "${disambiguatedTableName}"): ${retryMessage}`,
              });
            }
          }
        } else {
          result.errors.push({ slug: config.slug, error: message });
        }
      }
    }

    this.logger.info("Code-first sync completed", {
      created: result.created.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      errors: result.errors.length,
    });

    return result;
  }

  async registerCollectionInTransaction(
    tx: TransactionContext,
    data: DynamicCollectionInsert
  ): Promise<DynamicCollectionRecord> {
    await assertGlobalResourceSlugAvailable(this.adapter, data.slug);

    const existing = await tx.selectOne<DynamicCollectionRecord>(
      this.registryTableName,
      {
        where: this.whereEq("slug", data.slug),
      }
    );

    if (existing) {
      // Generic duplicate message; slug moves to logContext per §13.8.
      throw NextlyError.duplicate({
        logContext: {
          reason: "collection-slug-conflict-tx",
          slug: data.slug,
        },
      });
    }

    const now = this.formatDateForDb();
    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      labels: JSON.stringify(data.labels),
      table_name: data.tableName,
      description: data.description,
      fields: JSON.stringify(data.fields),
      timestamps: (data.timestamps ?? true) ? 1 : 0,
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? isPipelineSource(data.source)) ? 1 : 0,
      // Same as registerCollection — persist Draft/Published as 0/1.
      status: data.status === true ? 1 : 0,
      // Same as registerCollection — persist the resolved versioning config.
      versions: data.versions ? JSON.stringify(data.versions) : null,
      // Same as registerCollection — persist the cache-revalidation config.
      revalidate: data.revalidate ? JSON.stringify(data.revalidate) : null,
      // Same as registerCollection — persist the webhook recording policy.
      webhooks: data.webhooks ? JSON.stringify(data.webhooks) : null,
      localized: data.localized === true ? 1 : 0,
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      hooks: data.hooks ? JSON.stringify(data.hooks) : null,
      created_at: now,
      updated_at: now,
    };

    const result = await tx.insert<DynamicCollectionRecord>(
      this.registryTableName,
      record,
      { returning: "*" }
    );

    return this.deserializeRecord(result);
  }

  /**
   * Rename the physical table when a code-first collection's `dbName` changes.
   * Renames only when old exists and new doesn't; warns when both exist; no-op
   * otherwise (boot auto-create handles the missing-table case).
   */
  private async renamePhysicalTable(
    oldTableName: string,
    newTableName: string,
    slug: string
  ): Promise<void> {
    let oldExists: boolean;
    let newExists: boolean;
    try {
      oldExists = await this.adapter.tableExists(oldTableName);
      newExists = await this.adapter.tableExists(newTableName);
    } catch (error) {
      this.logger.warn(
        `Skipping rename for collection "${slug}": table introspection failed (${error instanceof Error ? error.message : String(error)}). Boot pipeline will reconcile.`
      );
      return;
    }

    if (oldExists && !newExists) {
      try {
        const { dialect } = this.adapter.getCapabilities();
        const q = dialect === "mysql" ? "`" : '"';
        await this.adapter.executeQuery(
          `ALTER TABLE ${q}${oldTableName}${q} RENAME TO ${q}${newTableName}${q}`
        );
      } catch (error) {
        this.logger.warn(
          `Failed to rename physical table for collection "${slug}" (${oldTableName} → ${newTableName}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (oldExists && newExists) {
      this.logger.warn(
        `Cannot rename physical table for collection "${slug}": both "${oldTableName}" and "${newTableName}" exist. Resolve manually (drop one or copy rows).`
      );
    }
  }

  private async seedPermissionsForCollection(slug: string): Promise<void> {
    if (!this.permissionSeedService) return;

    try {
      const result =
        await this.permissionSeedService.seedCollectionPermissions(slug);

      if (result.newPermissionIds.length > 0) {
        await this.permissionSeedService.assignNewPermissionsToSuperAdmin(
          result.newPermissionIds
        );
      }

      if (result.created > 0) {
        this.logger.info(
          `Permissions seeded for collection "${slug}": ${result.created} created, ${result.skipped} already existed`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to seed permissions for collection "${slug}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private labelsChanged(
    codeLabels: { singular: string; plural: string } | undefined,
    existingLabels: unknown
  ): boolean {
    if (!codeLabels && !existingLabels) return false;
    if (!codeLabels || !existingLabels) return true;
    const existing =
      typeof existingLabels === "string"
        ? JSON.parse(existingLabels)
        : existingLabels;
    return (
      codeLabels.singular !== existing.singular ||
      codeLabels.plural !== existing.plural
    );
  }

  protected deserializeRecord(
    record: DynamicCollectionRecord | Record<string, unknown>
  ): DynamicCollectionRecord {
    const r = record as Record<string, unknown>;
    const labels = (r.labels || r.labels) as string | object;
    const fields = (r.fields || r.fields) as string | object;
    const admin = (r.admin || r.admin) as string | object | null;
    const versions = r.versions as string | object | null | undefined;
    const revalidate = r.revalidate as string | object | null | undefined;
    const webhooks = r.webhooks as string | object | null | undefined;
    const hooks = (r.hooks || r.hooks) as string | object | null;
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
      tableName,
      description: r.description as string | undefined,
      labels: typeof labels === "string" ? JSON.parse(labels) : labels,
      fields: typeof fields === "string" ? JSON.parse(fields) : fields,
      timestamps: r.timestamps as boolean,
      admin: admin
        ? typeof admin === "string"
          ? JSON.parse(admin)
          : admin
        : undefined,
      hooks: hooks
        ? typeof hooks === "string"
          ? JSON.parse(hooks)
          : hooks
        : undefined,
      source: r.source as CollectionSource,
      locked: r.locked as boolean,
      // Why: read the new status meta-column, defaulting to false for rows
      // written before this column existed (legacy data without status set).
      // SQLite returns 0/1 even with mode:"boolean" in some driver/dialect
      // combinations, so accept both shapes.
      status: r.status === 1 || r.status === true,
      // Parse the resolved versioning config (JSON string on the raw-insert
      // path / SQLite; already an object on pg/mysql jsonb). null when
      // unversioned or on rows written before this column existed.
      versions: versions
        ? typeof versions === "string"
          ? JSON.parse(versions)
          : versions
        : null,
      // Parse the cache-revalidation config (JSON string on the raw-insert path
      // / SQLite; already an object on pg/mysql jsonb). null when unset or on
      // rows written before this column existed.
      revalidate: revalidate
        ? typeof revalidate === "string"
          ? JSON.parse(revalidate)
          : revalidate
        : null,
      // Parse the webhook recording policy (JSON string on the raw-insert path
      // / SQLite; already an object on pg/mysql jsonb). null when unset or on
      // rows written before this column existed, which reads as recording.
      webhooks: webhooks
        ? typeof webhooks === "string"
          ? JSON.parse(webhooks)
          : webhooks
        : null,
      localized: r.localized === 1 || r.localized === true,
      configPath,
      schemaHash,
      schemaVersion,
      migrationStatus: migrationStatus as MigrationStatus,
      lastMigrationId,
      createdBy,
      updatedAt: this.normalizeDbTimestamp(updatedAt) as string & Date,
      createdAt: this.normalizeDbTimestamp(createdAt) as string & Date,
    };
  }
}
