import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

import { resolveRelations } from "../../../database/resolve-relations";
import { NextlyError } from "../../../errors";
import type {
  RevalidateConfig,
  RevalidationIntent,
} from "../../../revalidation/types";
import { isReservedResourceSlug } from "../../../schemas/_zod/rbac";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type {
  StoredHookConfig,
  MigrationStatus,
  StoredWebhookRecording,
} from "../../../schemas/dynamic-collections/types";
import type { ResolvedVersionsConfig } from "../../../schemas/versions/types";
import { assertGlobalResourceSlugAvailable } from "../../../services/lib/resource-slug-guard";
import { listStoredRegistry } from "../../../shared/base-registry-service";
import { BaseService } from "../../../shared/base-service";
import { affectedRowCount } from "../../../shared/lib/affected-row-count";
import {
  registryPage,
  warnIfRegistryListingLarge,
} from "../../../shared/lib/registry-listing-page";
import type { Logger } from "../../../shared/types";
import type { DatabaseAdapter } from "../../../shared/types/database-adapter";
import {
  moveWebhookRecording,
  renameEntity,
} from "../../entity-rename/rename-entity";
import { flushContentChange } from "../../flush-content-change";
import { writeRegistryRows } from "../../schema/schema-version";
import {
  deleteEntityRegistryRow,
  entityTablesOn,
} from "../../versions/entity-teardown";
import {
  clearWebhookRecording,
  setWebhookRecording,
} from "../../webhooks/recording-policy";
import { isConfigOwnedSource } from "../../webhooks/recording-provenance";

import {
  cachedCollectionRow,
  clearRegistryRowCache,
  forgetRegistryRowsOnTransaction,
  registryReadTransaction,
  registryRowOnTransaction,
} from "./collection-row-cache";

export interface CollectionMetadata {
  id: string;
  slug: string;
  tableName: string;
  description?: string;
  labels: { singular: string; plural: string };
  fields: FieldDefinition[];
  timestamps?: boolean;
  /**
   * Whether the collection has the Draft/Published status feature enabled.
   * Backed by the `dynamic_collections.status` boolean column. When true,
   * the data table carries a `status` system column and the admin's Save
   * Draft / Publish split lights up.
   */
  status?: boolean;
  /**
   * i18n: whether the collection is localized. Backed by the
   * `dynamic_collections.localized` boolean column. When true, translatable fields
   * live in the companion `<table>_locales` table and the admin edits per-language.
   */
  localized?: boolean;
  /**
   * Resolved content-versioning config, or null when unversioned. Backed by
   * the `dynamic_collections.versions` JSON column.
   */
  versions?: ResolvedVersionsConfig | null;
  /**
   * Cache-revalidation config, or null when the collection sets none. Backed by
   * the `dynamic_collections.revalidate` JSON column; the write path reads it to
   * honor `disable` and merge extra `tags`.
   */
  revalidate?: RevalidateConfig | null;
  /**
   * Webhook recording policy, or null when the collection records (the
   * default). Backed by the `dynamic_collections.webhooks` JSON column; boot
   * reads it back so a Builder-authored opt-out survives a restart.
   */
  webhooks?: StoredWebhookRecording | null;
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    useAsTitle?: string;
    order?: number;
    sidebarGroup?: string;
    isPlugin?: boolean;
    disableCreate?: boolean;
    disableDelete?: boolean;
    pagination?: { defaultLimit?: number; limits?: number[] };
  };
  source?: "code" | "ui" | "built-in";
  locked?: boolean;
  configPath?: string;
  schemaHash: string;
  schemaVersion?: number;
  migrationStatus?: MigrationStatus;
  lastMigrationId?: string;
  /**
   * The canonical stored-hook shape, not a looser record: the registry row
   * these feed is typed with it, and the executor reads `config` and `order`
   * off every entry.
   */
  hooks?: StoredHookConfig[];
  createdBy?: string;
}

export interface ListCollectionsOptions {
  page?: number;
  limit?: number;
  search?: string;
  // "name" is the admin/API alias for "slug" (the API exposes the slug as
  // `name` to consumers). Both values order on the same physical column.
  sortBy?: "name" | "slug" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
  includeSchema?: boolean;
  source?: "code" | "ui" | "built-in";
  /**
   * Restrict results to collections whose `slug` is in this list.
   *
   * 🔴 Applied to the rows before they are counted, so the total and the
   * page see the same rows. A caller that filters the returned page instead
   * gets a `total` describing rows the reader may not see -- which both leaks
   * how many exist and collapses `totalPages` to 1, because the recomputed
   * total is at most one page. The consumer then reads "there is no next page"
   * and stops, with the rest of what it may see unreachable.
   *
   * `undefined` means no allowlist. `[]` means nothing is visible and
   * short-circuits to no rows and a zero total.
   */
  slugAllowlist?: string[];
  /**
   * Leave out collections whose `slug` is in this list: the plugins'
   * collections, on the list of the site's own. Applied before the count, so
   * the count and the page agree; with an allowlist both apply, so it only
   * ever removes rows. `undefined` or `[]` denies nothing.
   */
  slugDenylist?: string[];
}

export interface ListCollectionsResponse<
  TIncludeSchema extends boolean = true,
> {
  collections: TIncludeSchema extends true
    ? CollectionMetadata[]
    : Omit<CollectionMetadata, "fields">[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * `status` and `localized` as booleans, whichever dialect produced the row.
 *
 * SQLite returns them as 0|1 even with `mode: "boolean"` on some driver and
 * dialect combinations, while postgres returns a native boolean. Callers gate
 * on `=== true`, so an uncoerced 1 reads as false: a collection shows as Draft
 * in a list that renders published state, and a later field-only update treats
 * a localized collection as non-localized, emitting main-table alters for
 * columns that live in the companion.
 *
 * One function rather than one per read path. Every row this service hands
 * back passes through here, so a second read cannot be added that agrees today
 * and drifts later — which is what happened when the list projection began
 * returning these columns and did not coerce them.
 *
 * Not covered by a test, deliberately. Under better-sqlite3 the column's
 * `mode: "boolean"` already maps 0|1 before a caller sees it, so an assertion
 * here passes whether or not this function runs, and the combinations where it
 * does not map are the ones this suite cannot reach. A test that cannot fail
 * would read as coverage of a property nothing checked.
 */
function normalizeCollectionBooleans(
  row: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...row,
    status: row.status === 1 || row.status === true,
    localized: row.localized === 1 || row.localized === true,
  };
}

/**
 * What removing a collection's registry row found: how many rows went, and
 * the intent that expires its cached reads (`undefined` when nothing went or
 * the collection opted out), read from the row's own setting as it went.
 */
export interface UnregisteredCollectionRow {
  removed: number;
  expire: RevalidationIntent | undefined;
}

export class DynamicCollectionRegistryService extends BaseService {
  // Drizzle table refs differ per dialect — `any` here is intentional.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dynamicCollections: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dynamicSingles: any;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
    this.dynamicCollections = this.tables.dynamicCollections;
    this.dynamicSingles = this.tables.dynamicSingles;
  }

  private async ensureGlobalSlugUniqueness(
    slug: string,
    options?: { currentCollectionId?: string }
  ): Promise<void> {
    const existingCollection = await this.db
      .select({ id: this.dynamicCollections.id })
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug))
      .limit(1);

    // True when this exact slug is already owned by the collection being
    // updated (a no-op slug on a metadata/field/status change), as opposed to a
    // create or a rename onto another collection's slug.
    const ownedByCurrentCollection =
      existingCollection.length > 0 &&
      existingCollection[0]?.id === options?.currentCollectionId;

    // A name that collides with a system resource's permissions may not be used
    // as a Schema-Builder collection slug on create or rename. A collection that
    // already owns this exact slug (created before the name became reserved) is
    // grandfathered so its metadata stays editable — rejecting a no-op save
    // would strand it. This mirrors `assertGlobalResourceSlugAvailable`, which
    // this registry does not go through, so the check lives here as well.
    if (isReservedResourceSlug(slug) && !ownedByCurrentCollection) {
      throw NextlyError.validation({
        errors: [
          {
            path: "slug",
            code: "reserved_slug",
            message:
              "This name is reserved by Nextly and cannot be used as a slug. Choose a different name.",
          },
        ],
        logContext: { reason: "system-resource-slug", slug },
      });
    }

    if (
      existingCollection.length > 0 &&
      existingCollection[0]?.id !== options?.currentCollectionId
    ) {
      throw new Error(
        `Slug "${slug}" is already used by a collection. Slugs must be unique across collections and singles.`
      );
    }

    const existingSingle = await this.db
      .select({ id: this.dynamicSingles.id })
      .from(this.dynamicSingles)
      .where(eq(this.dynamicSingles.slug, slug))
      .limit(1);

    if (existingSingle.length > 0) {
      throw new Error(
        `Slug "${slug}" is already used by a single. Slugs must be unique across collections and singles.`
      );
    }
  }

  async registerCollection(metadata: CollectionMetadata): Promise<unknown> {
    await this.ensureGlobalSlugUniqueness(metadata.slug);

    // The cached rows are cleared once the insert has run, landed or not, so a
    // row read while it ran is not served after it.
    try {
      // With the stored schema version's count (`writeRegistryRows`), on the
      // write's transaction, where `this.db` then writes.
      await writeRegistryRows(this.adapter, () =>
        this.db.insert(this.dynamicCollections).values({
          id: metadata.id,
          slug: metadata.slug,
          tableName: metadata.tableName,
          description: metadata.description,
          labels: metadata.labels,
          fields: metadata.fields,
          timestamps: metadata.timestamps ?? true,
          admin: metadata.admin,
          source: metadata.source ?? "ui",
          locked: metadata.locked ?? false,
          // Draft/Published flag — Drizzle's mode:'boolean' on sqlite + native
          // bool on postgres/mysql both accept a JS boolean here.
          status: metadata.status === true,
          // i18n: persist the localized flag so the read/write path routes translatable
          // fields to the companion table and the admin shows per-language editing. Without
          // it, a UI-created localized collection is stored as non-localized (shared).
          localized: metadata.localized === true,
          // Resolved versioning config (or null when unversioned). Stored as JSON
          // the same way `admin` is; Drizzle serializes the object per dialect.
          versions: metadata.versions ?? null,
          // Cache-revalidation config (or null). Stored as JSON like `versions`.
          revalidate: metadata.revalidate ?? null,
          // Webhook recording policy (or null). Stored as JSON like `revalidate`.
          webhooks: metadata.webhooks ?? null,
          configPath: metadata.configPath,
          schemaHash: metadata.schemaHash,
          schemaVersion: metadata.schemaVersion ?? 1,
          migrationStatus: metadata.migrationStatus ?? "pending",
          lastMigrationId: metadata.lastMigrationId,
          hooks: metadata.hooks,
          createdBy: metadata.createdBy,
        })
      );
    } finally {
      clearRegistryRowCache();
    }

    // Publish the decision into the live policy as well as the column. The
    // boot-time read only runs at startup, so without this a Builder-created
    // collection would keep recording until the next restart — precisely the
    // window in which its first content is written. Code-first entities are
    // skipped: their config is the source of truth and is already published.
    if (!isConfigOwnedSource(metadata.source)) {
      setWebhookRecording(
        "collection",
        metadata.slug,
        metadata.webhooks?.record !== false,
        "db"
      );
    }

    // Avoids .returning() which is not supported in all MySQL versions/drivers.
    return metadata;
  }

  async updateCollectionMetadata(
    collectionSlug: string,
    updates: Partial<CollectionMetadata>
  ): Promise<unknown> {
    const existing = await this.db
      .select({
        id: this.dynamicCollections.id,
        slug: this.dynamicCollections.slug,
        // Needed to keep code-first config outranking the stored row when the
        // recording switch is mirrored into the live policy below.
        source: this.dynamicCollections.source,
        // The stored recording decision, which a rename carries to the new
        // slug when this update does not set one.
        webhooks: this.dynamicCollections.webhooks,
      })
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, collectionSlug))
      .limit(1);

    if (existing.length === 0) {
      /*
       * 🔴 TYPED, and the message is unchanged on purpose. Callers decide
       * "does this collection exist" from this error; a bare `Error` forced
       * them to read its prose, and one of them then missed the branded
       * `NextlyError.notFound()` the OTHER registry raises. Carrying both a
       * `NOT_FOUND` code and the wording every existing caller already matches
       * lets a guard ask by type without breaking one that still asks by text.
       * Product code here throws `NextlyError`, never a bare `Error`.
       */
      throw NextlyError.notFound({
        message: `Collection "${collectionSlug}" not found`,
        logContext: { collection: collectionSlug },
      });
    }

    const targetSlug = updates.slug ?? existing[0].slug;
    // A rename's new address is judged by the one address rule, inside the schema lock, in the
    // rename branch below. Any other update keeps the slug it has and is checked as before.
    if (targetSlug === existing[0].slug) {
      await this.ensureGlobalSlugUniqueness(targetSlug, {
        currentCollectionId: existing[0].id,
      });
    }

    const updateData: Record<string, unknown> = { ...updates };

    delete updateData.id;

    updateData.updatedAt = new Date();

    // The one statement that writes the row, on whichever handle it is given:
    // the pooled one for an ordinary update, the rename's transaction below.
    // Matched by the id read above as well as the slug: a collection deleted
    // and another registered under the slug since then is not the one asked
    // for, and is left alone, as a row that is gone is.
    const writeRow = (db: DatabaseAdapter["db"]) =>
      db
        .update(this.dynamicCollections)
        .set(updateData)
        .where(
          and(
            eq(this.dynamicCollections.slug, collectionSlug),
            eq(this.dynamicCollections.id, existing[0].id)
          )
        );

    const move = {
      kind: "collection" as const,
      from: collectionSlug,
      to: targetSlug,
    };
    // Cleared once the update has run, as after an insert, and after a
    // rename too: the row then lives under the new slug.
    try {
      if (targetSlug === existing[0].slug) {
        // With the stored schema version's count (`writeRegistryRows`); a
        // rename moves it in its own transaction (`renameEntity`).
        await writeRegistryRows(this.adapter, () => writeRow(this.db));
      } else {
        // A changed slug is a rename. Everything keyed by the old slug (history,
        // markers, events, release members, permissions, webhook filters) moves
        // in the same transaction as the registry row, so the two commit
        // together or neither does; otherwise the renamed collection would lose
        // them and the next collection created under the old slug would inherit
        // them.
        //
        // The new address is judged inside the schema lock `renameEntity` holds for the rename,
        // so a collection or Single that takes the same snake_case form while this waits is seen,
        // and one that tries while the rename holds the lock is refused. The rule is the one
        // every road applies (reserved names, routes, a taken slug, and a same snake_case form
        // among collections and Singles).
        const renamed = await renameEntity(this.adapter, {
          dialect: this.dialect,
          move,
          judgeTarget: () =>
            assertGlobalResourceSlugAvailable(this.adapter, targetSlug, {
              currentResourceType: "collection",
              currentResourceId: existing[0].id,
            }),
          writeRegistry: async tx => {
            const written = await writeRow(
              tx.drizzleWithRelations<DatabaseAdapter["db"]>(
                resolveRelations(this.dialect)
              )
            );
            // No row under the old slug with the id read above any more
            // (deleted, replaced, or renamed by another request, since the
            // lookup): nothing is moved, so no history follows a registry row
            // that did not move.
            return affectedRowCount(written, this.dialect) === 0 ? null : move;
          },
          logger: this.logger,
        });
        if (renamed === null) {
          throw NextlyError.notFound({
            message: `Collection "${collectionSlug}" not found`,
            logContext: { collection: collectionSlug },
          });
        }
      }
    } finally {
      clearRegistryRowCache();
    }

    // A rename carries the live recording decision to the new slug and drops
    // the old slug's entry, so a collection created there later starts from
    // the default rather than inheriting this one's choice.
    if (
      targetSlug !== existing[0].slug &&
      !isConfigOwnedSource(existing[0].source)
    ) {
      // The decision this update commits: the one it writes, or the one the
      // row already held.
      const stored =
        updates.webhooks !== undefined
          ? updates.webhooks
          : existing[0].webhooks;
      // Once the row's write commits: joined to a transaction that rolls back, it never happened.
      await this.adapter.afterCommit(() =>
        moveWebhookRecording(move, stored?.record !== false)
      );
    }

    // Mirror the stored change into the live policy so turning the switch off
    // takes effect on the next write rather than the next restart. Keyed on the
    // slug the row is now stored under, the new one after a rename, so the
    // policy key and the persisted row can never disagree.
    if (
      updates.webhooks !== undefined &&
      !isConfigOwnedSource(existing[0].source)
    ) {
      // Once the row's write commits, as the move above.
      await this.adapter.afterCommit(() =>
        setWebhookRecording(
          "collection",
          targetSlug,
          updates.webhooks?.record !== false,
          "db"
        )
      );
    }

    // Read back under the slug the row is stored under now: after a rename the
    // old one names nothing.
    return this.getCollection(targetSlug);
  }

  /**
   * List collections with pagination, search, and sorting.
   */
  async listCollections<TIncludeSchema extends boolean = true>(
    options?: ListCollectionsOptions & { includeSchema?: TIncludeSchema }
  ): Promise<ListCollectionsResponse<TIncludeSchema>> {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeSchema = true as TIncludeSchema,
      source,
      slugAllowlist,
      slugDenylist,
    } = options || {};

    // An empty allowlist means the caller may see nothing. Answered here
    // rather than as a query, because `WHERE slug IN ()` is a dialect-specific
    // footgun and because a zero-row read is work nobody needs done.
    if (slugAllowlist && slugAllowlist.length === 0) {
      return {
        collections: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    // 🔴 CONDITIONS, not a filter over the result. The allowlist and the
    // denylist (the plugins' collections, on the site's own list) decide
    // which rows are counted, before the total is taken and the page cut, so
    // the total describes exactly the rows this caller may see and
    // `totalPages` counts pages of those.
    //
    // In memory, from the registry listing this process holds: the registry
    // is the documented exception to paging in the database
    // (`shared/lib/registry-listing-page` says why). Page and total come
    // from one snapshot of it, and an unchanged registry costs no statement.
    const allowed = slugAllowlist ? new Set(slugAllowlist) : undefined;
    const denied = new Set(slugDenylist ?? []);
    const table = "dynamic_collections";
    const listed = await listStoredRegistry(
      this.adapter,
      this.dialect,
      table,
      rows => {
        warnIfRegistryListingLarge("Collection", rows.length, message =>
          this.logger.warn(message)
        );
        const found = registryPage(rows, {
          include: row => {
            const slug = String(row.slug);
            return (
              (allowed === undefined || allowed.has(slug)) &&
              !denied.has(slug) &&
              (!source || row.source === source)
            );
          },
          ...(search
            ? { search: { text: search, columns: ["slug", "description"] } }
            : {}),
          // "name" is the admin/API alias for "slug": both sort on the slug.
          orderBy:
            sortBy === "name" || sortBy === "slug"
              ? "slug"
              : sortBy === "updatedAt"
                ? "updatedAt"
                : "createdAt",
          direction: sortOrder === "asc" ? "asc" : "desc",
          offset: (page - 1) * limit,
          limit,
        });
        return {
          total: found.total,
          rows: found.rows.map(row => {
            const copy = structuredClone(row) as Record<string, unknown>;
            // `fields` is the only column the schema-less shape drops, and
            // the return type says so: `Omit<CollectionMetadata, "fields">`.
            if (!includeSchema) delete copy.fields;
            return copy;
          }),
        };
      }
    );

    const total = listed.total;
    const totalPages = Math.ceil(total / limit);

    return {
      // Both shapes carry `status` and `localized`, so both need the same
      // coercion `getCollection` applies — see `normalizeCollectionBooleans`.
      collections: listed.rows.map(
        normalizeCollectionBooleans
      ) as ListCollectionsResponse<TIncludeSchema>["collections"],
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * One collection's registry row, by slug. Outside a transaction it comes
   * from the row cache (`collection-row-cache`): a copy, kept until the
   * stored count of registry writes moves, so a change made elsewhere is seen
   * within `REGISTRY_ROW_STALENESS_MS`, and current for one made here. Read on a
   * transaction, it comes from that transaction's memo
   * (`registryRowOnTransaction`): read there once, uncached by any other, so
   * the transaction sees its own writes and no other transaction does. Inside
   * a transaction but read through the pool, it is read every time, as
   * before.
   */
  async getCollection(slug: string, executor?: unknown): Promise<unknown> {
    const transaction = registryReadTransaction(this.adapter, executor);
    if (transaction !== undefined) {
      // The row as stored, under the key the registry services' own lookup
      // (`getRecordBySlug`) holds it by: one read of it serves both.
      const stored = await registryRowOnTransaction(
        transaction,
        "record:dynamic_collections",
        slug,
        () => this.readStoredCollection(slug, executor)
      );
      return this.normalizedOrMissing(slug, stored);
    }
    if (executor !== undefined || this.adapter.transactionOpenInFlow()) {
      return this.readCollection(slug, executor);
    }
    return cachedCollectionRow(this.adapter, slug, () =>
      this.readCollection(slug)
    );
  }

  /** One collection's registry row from the database, booleans normalized. */
  private async readCollection(
    slug: string,
    executor?: unknown
  ): Promise<Record<string, unknown>> {
    return this.normalizedOrMissing(
      slug,
      await this.readStoredCollection(slug, executor)
    );
  }

  /** One collection's registry row as stored, or null when there is none. */
  private async readStoredCollection(
    slug: string,
    executor?: unknown
  ): Promise<Record<string, unknown> | null> {
    // Run on the caller's transaction executor when supplied so this metadata
    // read does not take a second pooled connection from inside the caller's
    // transaction (which can stall against a small pool); falls back to the
    // pooled connection otherwise. The transaction-bound Drizzle instance is the
    // same query-builder shape as `this.db`.
    const db = executor ?? this.db;
    const result = await db
      .select()
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug))
      .limit(1);
    return (result[0] as Record<string, unknown> | undefined) ?? null;
  }

  /** A stored row with its booleans normalized; a missing one is not found. */
  private normalizedOrMissing(
    slug: string,
    row: Record<string, unknown> | null
  ): Record<string, unknown> {
    if (row === null) {
      // Typed for the same reason as above, with the wording preserved.
      throw NextlyError.notFound({
        message: `Collection "${slug}" not found`,
        logContext: { collection: slug },
      });
    }
    return normalizeCollectionBooleans(row);
  }

  async collectionExists(slug: string): Promise<boolean> {
    const result = await this.db
      .select({ id: this.dynamicCollections.id })
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug))
      .limit(1);

    return result.length > 0;
  }

  async unregisterCollection(slug: string): Promise<void> {
    let unregistered: UnregisteredCollectionRow;
    // Cleared once the delete has run, as after an insert.
    try {
      unregistered = await this.adapter.transaction(tx =>
        this.unregisterCollectionIn(tx, slug)
      );
    } finally {
      clearRegistryRowCache();
    }
    await this.forgetUnregisteredCollection(slug, unregistered);
  }

  /**
   * Lock the registry rows of `slugs` inside `tx`, and answer the slugs whose
   * row is there, the id of each row held (`ids`, by slug), and how to end the
   * hold early (`release`). The ids tell a caller that loaded the rows before
   * taking the hold whether the row it now holds is the one it loaded: a slug
   * deleted and created again between the two holds a new row.
   *
   * `"update"` is a collection delete's: taken before it removes anything, so
   * a write holding a row for `"share"` (one that must not outlive the
   * collection, such as a plugin's row naming it) and the delete take turns.
   * The write either commits before the delete reads what it removes, or
   * waits and finds the row gone. SQLite has one writer at a time, so there
   * the rows are only read.
   *
   * MySQL ends a transaction at its first table drop, which releases row
   * locks while the delete still has the registry rows to remove. So there
   * each side also takes the collection's named lock on the transaction's
   * connection (`GET_LOCK`), which a commit does not release: the delete
   * holds it until `release`, which it calls once its last statement has
   * run, and a write holds it only across its read of the row. A write that
   * waited for a delete therefore reads the row after the delete removed it.
   * The lock belongs to the connection, so `release` must run before the
   * transaction hands the connection back, and a hold for `"share"` releases
   * its own before it returns. `waitMs` is how long it waits there for all its
   * named locks together; left out, each is waited for as long as the hold's
   * own wait.
   */
  async holdCollectionsIn(
    tx: TransactionContext,
    slugs: readonly string[],
    strength: "share" | "update",
    options: { waitMs?: number } = {}
  ): Promise<{
    existing: string[];
    ids: ReadonlyMap<string, string>;
    /** Each held row's `schema_version`, which every save of the collection moves. */
    versions: ReadonlyMap<string, number>;
    /** Each held row's `schema_hash`, which a save's file moves with the fields it writes. */
    hashes: ReadonlyMap<string, string>;
    release: () => Promise<void>;
  }> {
    const none = (): Promise<void> => Promise.resolve();
    if (slugs.length === 0) {
      return {
        existing: [],
        ids: new Map(),
        versions: new Map(),
        hashes: new Map(),
        release: none,
      };
    }
    const named =
      this.dialect === "mysql"
        ? await takeNamedCollectionLocks(
            this.adapter,
            query => tx.queryStatement(query),
            slugs,
            options.waitMs
          )
        : { release: none };
    // Keyed by the table's property names, as a row read through the adapter is.
    let rows: {
      slug: string;
      id: unknown;
      schemaVersion: unknown;
      schemaHash: unknown;
    }[];
    try {
      rows = await tx.select<{
        slug: string;
        id: unknown;
        schemaVersion: unknown;
        schemaHash: unknown;
      }>("dynamic_collections", {
        columns: ["slug", "id", "schema_version", "schema_hash"],
        where: { and: [{ column: "slug", op: "IN", value: [...slugs] }] },
        ...(strength === "update" ? { forUpdate: true } : { forShare: true }),
      });
    } catch (error) {
      await named.release();
      throw error;
    }
    // Held now, the rows are the latest committed: a row the transaction
    // read before the hold may predate a commit the hold waited for.
    forgetRegistryRowsOnTransaction(this.adapter);
    const existing = rows.map(row => row.slug);
    const ids = new Map(rows.map(row => [row.slug, String(row.id)]));
    const versions = new Map(
      rows.map(row => [row.slug, Number(row.schemaVersion)])
    );
    const hashes = new Map(rows.map(row => [row.slug, String(row.schemaHash)]));
    if (strength === "share") {
      await named.release();
      return { existing, ids, versions, hashes, release: none };
    }
    return { existing, ids, versions, hashes, release: named.release };
  }

  /**
   * Remove a collection's registry row inside `tx`, with what goes with it:
   * its autosaves, the pins held on its versions, its readers' "seen" markers
   * and dashboard pins, and the record of the media its entries use
   * (`deleteEntityRegistryRow`, the one sweep every path deleting a registry
   * row runs). All of it goes with whatever else that transaction removes or
   * not at all, and after the delete's table drops have run in it, so a drop
   * that fails on MySQL, where each drop commits, leaves the collection
   * registered with all of these for a second delete to finish.
   *
   * The setting and the delete run with the row locked between them: the
   * expiry after the commit uses the setting the deleted row held, and a
   * second delete racing this one waits, then finds nothing to remove. What
   * the process remembers about the collection is the caller's to forget once
   * `tx` has committed (`forgetUnregisteredCollection`, given what this
   * returns): forgotten earlier, a rollback would leave the row and lose what
   * was known about it.
   */
  async unregisterCollectionIn(
    tx: TransactionContext,
    slug: string
  ): Promise<UnregisteredCollectionRow> {
    // Whether the dashboard's and the media library's tables exist, asked on
    // `tx`'s own connection (`entityTablesOn`).
    const tables = await entityTablesOn(this.adapter, this.logger, tx);
    // Counts the registry write and clears the cached rows as the row goes,
    // so a read later in `tx` does not find it; the recording decision stays
    // the caller's to forget once `tx` commits.
    const { deleted, expire } = await deleteEntityRegistryRow(
      tx,
      "collection",
      slug,
      tables,
      this.dialect
    );
    return { removed: deleted, expire };
  }

  /**
   * Forget, in this process, a collection whose registry row is gone: its
   * cached rows, cleared as after any registry write, and its recording
   * decision, since a later collection created under the same slug must start
   * from the recording default rather than inherit a suppression whose row no
   * longer exists.
   */
  async forgetUnregisteredCollection(
    slug: string,
    unregistered: UnregisteredCollectionRow
  ): Promise<void> {
    clearRegistryRowCache();
    clearWebhookRecording("collection", slug);

    // Every cached read of it now describes rows that are gone. Only when this
    // delete removed the row, with the setting it held: a repeated delete finds
    // nothing and expires nothing. Once the delete is durable: after an
    // enclosing transaction commits, and never for one that rolls back.
    if (unregistered.removed > 0) {
      await this.afterCommit(() =>
        flushContentChange(
          unregistered.expire,
          this.logger,
          "a collection was deleted"
        )
      );
    }
  }
}

/** How long a hold waits for another's named lock on a collection, in seconds. */
const NAMED_LOCK_WAIT_SECONDS = 30;

/**
 * The name of collection `slug`'s named lock on MySQL, in the database named
 * `database` (`DATABASE()` on the connection, null where none is selected).
 *
 * MySQL's named locks belong to the server, not to a database, so a name
 * built from the slug alone would be shared by every Nextly database on one
 * server: a delete in one would hold up a write or a delete of the same slug
 * in another. The name is a hash of both, as the migration lock's is, since
 * MySQL caps a lock name at 64 characters. The two are kept apart by a NUL,
 * which neither holds, so no database and slug run together into another.
 */
export function namedCollectionLockName(
  database: string | null,
  slug: string
): string {
  const hash = createHash("sha256")
    .update(`${database ?? ""}\u0000${slug}`)
    .digest("hex");
  return `nextly:collection:${hash.slice(0, 40)}`;
}

/**
 * The name collection `slug`'s named lock had before it was named for the
 * database: a hash of the slug alone. Still taken beside the new name: see
 * {@link namedCollectionLockNames}.
 */
export function legacyCollectionLockName(slug: string): string {
  const hash = createHash("sha256").update(slug).digest("hex");
  return `nextly:collection:${hash.slice(0, 40)}`;
}

/**
 * The named locks a hold of `slugs` takes on MySQL, in the order it takes
 * them, in the database named `database`.
 *
 * Each slug's lock under its old name comes first, then under its name for
 * the database ({@link namedCollectionLockName}). While a rolling deployment
 * runs, instances still on the old release take only the old name, and a
 * hold that took only the new one would not wait for theirs: a write could
 * name a collection one of them is deleting. Taking both keeps every
 * instance in step until none on the old release is left; the old name may
 * then be dropped. Until then two databases on one server still share the
 * old name, as they did before.
 *
 * The old names are taken in the order the old release takes them, by slug,
 * and before any new name, which the old release never takes. So a hold on
 * either release takes the names it shares with another in the same order,
 * and two holds of overlapping sets cannot each hold a name the other waits
 * for.
 */
export function namedCollectionLockNames(
  database: string | null,
  slugs: readonly string[]
): string[] {
  const sorted = [...new Set(slugs)].sort();
  return [
    ...sorted.map(legacyCollectionLockName),
    ...sorted.map(slug => namedCollectionLockName(database, slug)),
  ];
}

/**
 * The database each adapter's connections are in (`DATABASE()`), read once: every connection of
 * one adapter's pool is opened on the database its configuration names, so one read answers for
 * all of them, and a hold costs no statement for it after the first. A read that fails is not
 * kept, and the next hold reads again.
 */
const databaseOfAdapter = new WeakMap<object, Promise<string | null>>();

/**
 * The rows a query answers on the connection a hold runs on: a transaction's
 * (`TransactionContext.queryStatement`), or a migration try's (`rowsOnConnection`).
 */
type RowsOn = <T>(query: SQL) => Promise<T[]>;

function databaseNameOf(
  adapter: object,
  rowsOn: RowsOn
): Promise<string | null> {
  const known = databaseOfAdapter.get(adapter);
  if (known !== undefined) return known;
  const reading = rowsOn<{ name: unknown }>(
    sql`SELECT DATABASE() AS ${sql.identifier("name")}`
  ).then(([row]) => (typeof row?.name === "string" ? row.name : null));
  databaseOfAdapter.set(adapter, reading);
  reading.catch(() => databaseOfAdapter.delete(adapter));
  return reading;
}

/**
 * One statement that takes `names` in order and stops at the first it does not get: it answers how
 * many it holds, the first that many of `names`. MySQL's `IF` evaluates only the branch it returns,
 * so no name after a refused one is asked for.
 *
 * Each name is waited for up to `waitSeconds`; `together`, all of them are, each for what the ones
 * before it left: `NOW` is when the statement began and `SYSDATE` the time it is read at. A server
 * started with `--sysdate-is-now` reads both alike, and there each name is waited for on its own.
 */
function takeInOrder(
  names: readonly string[],
  waitSeconds: number,
  together: boolean
): SQL {
  const left = sql`GREATEST(0, ${waitSeconds} - TIMESTAMPDIFF(SECOND, NOW(6), SYSDATE(6)))`;
  let taken: SQL = sql`${names.length}`;
  for (let index = names.length - 1; index >= 0; index--) {
    const wait = together && index > 0 ? left : sql`${waitSeconds}`;
    taken = sql`IF(GET_LOCK(${names[index]}, ${wait}) = 1, ${taken}, ${index})`;
  }
  return taken;
}

/**
 * The named locks of `slugs` on MySQL ({@link namedCollectionLockNames}), taken on the connection
 * `rowsOn` runs on, for the database the connection is in, in one statement, and released in one, in
 * the reverse of the order taken.
 *
 * Every way the take can end leaves none of them held on the connection: a name not got in time
 * is refused as `COLLECTION_BEING_CHANGED`, with the names already got released first; a take
 * that fails part way, whatever it got, releases every name, since `RELEASE_LOCK` of a name the
 * connection does not hold changes nothing.
 */
async function takeNamedCollectionLocks(
  adapter: object,
  rowsOn: RowsOn,
  slugs: readonly string[],
  /**
   * How long the names are waited for together, in whole seconds of the server's. Left out, each is
   * waited for on its own, as long as the hold's wait.
   */
  waitMs?: number
): Promise<{ release: () => Promise<void> }> {
  const names = namedCollectionLockNames(
    await databaseNameOf(adapter, rowsOn),
    slugs
  );
  // The names held: the first `held` of `names`.
  let held = 0;
  const release = async (): Promise<void> => {
    const releasing = names.slice(0, held).reverse();
    held = 0;
    if (releasing.length === 0) return;
    await rowsOn(
      sql`SELECT ${sql.join(
        releasing.map(name => sql`RELEASE_LOCK(${name})`),
        sql`, `
      )}`
    );
  };
  let got: number;
  try {
    const [row] = await rowsOn<{ taken: unknown }>(
      sql`SELECT ${
        waitMs === undefined
          ? takeInOrder(names, NAMED_LOCK_WAIT_SECONDS, false)
          : takeInOrder(names, Math.ceil(waitMs / 1000), true)
      } AS ${sql.identifier("taken")}`
    );
    got = Number(row?.taken);
  } catch (error) {
    held = names.length;
    await release();
    throw error;
  }
  if (got === names.length) {
    held = got;
    return { release };
  }
  // Refused part way: the names it got are released. A count that cannot be read says nothing of
  // which it got, so every name is.
  const counted = Number.isInteger(got) && got >= 0 && got < names.length;
  held = counted ? got : names.length;
  await release();
  throw new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection is being changed elsewhere. Try again in a moment.",
    logContext: {
      reason: "collection-named-lock-timeout",
      ...(counted ? { lock: names[got] } : { taken: String(got) }),
    },
  });
}

/**
 * The rows a query answers on `db`, the handle a migration try's `before` and `settled` are given
 * on MySQL (a transaction's Drizzle handle, or the try's session), each answering `[rows, fields]`.
 */
function rowsOnConnection(db: unknown): RowsOn {
  return async <T>(query: SQL): Promise<T[]> => {
    const [rows] = (await (
      db as { execute(query: SQL): Promise<unknown> }
    ).execute(query)) as [T[]];
    return rows;
  };
}

/**
 * The rows a query answers on `session`, a connection held for one caller (`withSession`), its
 * Drizzle query compiled for MySQL as the migration runner compiles one for its session.
 */
function rowsOnSession(session: StatementSession): RowsOn {
  const compiler = new MySqlDialect();
  return <T>(query: SQL): Promise<T[]> => {
    const compiled = compiler.sqlToQuery(query);
    return session.execute<T>(compiled.sql, compiled.params as SqlParam[]);
  };
}

/**
 * Collection `slug` held as a collection delete holds it (`holdCollectionsIn` for `"update"`), on
 * the connection `rowsOn` runs on: its named locks first, then its registry row `FOR UPDATE`, which
 * waits for every entry write that already read the row for share to commit. An entry write that
 * starts after waits at the named locks until `release`, which must run on the same connection. A
 * take that fails releases what it got before it throws.
 *
 * MySQL documents a locking read's row locks for a read inside a transaction. So on a connection
 * outside any transaction (`rowRead: "own-transaction"`) the read runs in a transaction of its
 * own, committed once it has the lock, which makes that guarantee explicit rather than resting on
 * how a read under autocommit takes its locks; the row's lock then ends and the named locks stay.
 * Inside the caller's transaction (`"in-transaction"`) the read runs there.
 */
async function holdCollectionWith(
  adapter: object,
  rowsOn: RowsOn,
  slug: string,
  rowRead: "in-transaction" | "own-transaction"
): Promise<{ release: () => Promise<void> }> {
  const named = await takeNamedCollectionLocks(adapter, rowsOn, [slug]);
  const own = rowRead === "own-transaction";
  try {
    if (own) await rowsOn(sql`START TRANSACTION`);
    await rowsOn(
      sql`SELECT ${sql.identifier("id")} FROM ${sql.identifier("dynamic_collections")} WHERE ${sql.identifier("slug")} = ${slug} FOR UPDATE`
    );
    if (own) await rowsOn(sql`COMMIT`);
  } catch (error) {
    if (own) await rowsOn(sql`ROLLBACK`).catch(() => undefined);
    await named.release();
    throw error;
  }
  return named;
}

/**
 * A deleting save's hold of collection `slug` on MySQL, on a connection held for it alone
 * (`session`, from `withSession`, outside any transaction), for a save whose change runs on other
 * connections (a push): the named locks belong to the server by name, so an entry write waits for
 * them wherever it runs, and the registry row's lock ends with its statement, so the change may
 * write the row. Released on `session` by `release` ({@link holdCollectionWith}).
 */
export function holdCollectionOnSession(
  adapter: object,
  session: StatementSession,
  slug: string
): Promise<{ release: () => Promise<void> }> {
  return holdCollectionWith(
    adapter,
    rowsOnSession(session),
    slug,
    "own-transaction"
  );
}

/**
 * A deleting save's hold of collection `slug` on MySQL, taken on the migration try's own connection
 * (`db`, the handle the runner gives the try's `before`), as a collection delete holds it
 * (`holdCollectionsIn` for `"update"`): its named locks first, then its registry row `FOR UPDATE`,
 * which waits for every entry write that already read the row for share to commit. An entry write
 * that starts after waits at the named locks until `release`, which runs on the same connection in
 * the try's `settled`. A take that fails releases what it got before it throws.
 */
export async function holdCollectionOnConnection(
  adapter: object,
  db: unknown,
  slug: string
): Promise<{ release: () => Promise<void>; connection: string }> {
  const rowsOn = rowsOnConnection(db);
  // The migration try's transaction, which the runner opens before `before` runs.
  const hold = await holdCollectionWith(
    adapter,
    rowsOn,
    slug,
    "in-transaction"
  );
  try {
    // The connection the hold belongs to, for `closeHoldingConnection` where its release fails.
    const [row] = await rowsOn<{ id: unknown }>(
      sql`SELECT CONNECTION_ID() AS ${sql.identifier("id")}`
    );
    return { release: hold.release, connection: String(row?.id) };
  } catch (error) {
    await hold.release();
    throw error;
  }
}

/**
 * Closes MySQL connection `connection` (its `CONNECTION_ID()`) from a pooled connection of
 * `adapter`: where a hold's release failed on it, so its named locks end with it, rather than
 * going back to the pool held. Run once the transaction on that connection has ended, never inside
 * it, which closing would roll back. A connection already gone is passed over.
 */
export async function closeHoldingConnection(
  adapter: {
    executeQuery(statement: string, params?: SqlParam[]): Promise<unknown>;
  },
  connection: string
): Promise<void> {
  // A connection id is a whole number read from the server, never caller input.
  if (!/^\d+$/.test(connection)) return;
  const compiled = new MySqlDialect().sqlToQuery(
    sql`KILL ${sql.raw(connection)}`
  );
  await adapter
    .executeQuery(compiled.sql, compiled.params as SqlParam[])
    .catch(() => undefined);
}
