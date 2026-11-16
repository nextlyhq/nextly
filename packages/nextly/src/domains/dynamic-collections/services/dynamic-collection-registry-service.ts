import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { eq, and, sql } from "drizzle-orm";

import { resolveRelations } from "../../../database/resolve-relations";
import { NextlyError } from "../../../errors";
import type { RevalidateConfig } from "../../../revalidation/types";
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
import {
  deletedEntityIntent,
  flushContentChange,
} from "../../flush-content-change";
import {
  countRegistryWriteOn,
  writeRegistryRows,
} from "../../schema/schema-version";
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

/** What removing a collection's registry row found: how many rows went, and the cache setting the row held. */
export interface UnregisteredCollectionRow {
  removed: number;
  stored: unknown;
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
      moveWebhookRecording(move, stored?.record !== false);
    }

    // Mirror the stored change into the live policy so turning the switch off
    // takes effect on the next write rather than the next restart. Keyed on the
    // slug the row is now stored under, the new one after a rename, so the
    // policy key and the persisted row can never disagree.
    if (
      updates.webhooks !== undefined &&
      !isConfigOwnedSource(existing[0].source)
    ) {
      setWebhookRecording(
        "collection",
        targetSlug,
        updates.webhooks?.record !== false,
        "db"
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
   * its own before it returns.
   */
  async holdCollectionsIn(
    tx: TransactionContext,
    slugs: readonly string[],
    strength: "share" | "update"
  ): Promise<{
    existing: string[];
    ids: ReadonlyMap<string, string>;
    release: () => Promise<void>;
  }> {
    const none = (): Promise<void> => Promise.resolve();
    if (slugs.length === 0) {
      return { existing: [], ids: new Map(), release: none };
    }
    const named =
      this.dialect === "mysql"
        ? await takeNamedCollectionLocks(tx, slugs)
        : { release: none };
    let rows: { slug: string; id: unknown }[];
    try {
      rows = await tx.select<{ slug: string; id: unknown }>(
        "dynamic_collections",
        {
          columns: ["slug", "id"],
          where: { and: [{ column: "slug", op: "IN", value: [...slugs] }] },
          ...(strength === "update" ? { forUpdate: true } : { forShare: true }),
        }
      );
    } catch (error) {
      await named.release();
      throw error;
    }
    // Held now, the rows are the latest committed: a row the transaction
    // read before the hold may predate a commit the hold waited for.
    forgetRegistryRowsOnTransaction(this.adapter);
    const existing = rows.map(row => row.slug);
    const ids = new Map(rows.map(row => [row.slug, String(row.id)]));
    if (strength === "share") {
      await named.release();
      return { existing, ids, release: none };
    }
    return { existing, ids, release: named.release };
  }

  /**
   * Remove a collection's registry row inside `tx`, so it goes with whatever
   * else that transaction removes or not at all. The setting and the delete
   * run with the row locked between them: the expiry after the commit uses
   * the setting the deleted row held, and a second delete racing this one
   * waits, then finds nothing to remove. What the process remembers about the
   * collection is the caller's to forget once `tx` has committed
   * (`forgetUnregisteredCollection`, given what this returns): forgotten
   * earlier, a rollback would leave the row and lose what was known about it.
   */
  async unregisterCollectionIn(
    tx: TransactionContext,
    slug: string
  ): Promise<UnregisteredCollectionRow> {
    const where = {
      and: [{ column: "slug", op: "=" as const, value: slug }],
    };
    const [row] = await tx.select<{ revalidate: unknown }>(
      "dynamic_collections",
      { columns: ["revalidate"], where, forUpdate: true }
    );
    const removed = await tx.delete("dynamic_collections", where);
    // The stored schema version's count moves in the same transaction.
    if (removed > 0) await countRegistryWriteOn(tx, this.dialect);
    // Cleared as it is removed, so a read later in `tx` does not find the row
    // the transaction read before; the recording decision stays the caller's
    // to forget once `tx` commits.
    clearRegistryRowCache();
    return { removed, stored: row?.revalidate };
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
          deletedEntityIntent("collection", slug, unregistered.stored),
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
 * The named locks of `slugs` on MySQL ({@link namedCollectionLockNames}),
 * taken on `tx`'s connection, for the database the connection is in.
 */
async function takeNamedCollectionLocks(
  tx: TransactionContext,
  slugs: readonly string[]
): Promise<{ release: () => Promise<void> }> {
  const [selected] = await tx.queryStatement<{ name: unknown }>(
    sql`SELECT DATABASE() AS ${sql.identifier("name")}`
  );
  const database = typeof selected?.name === "string" ? selected.name : null;
  const names = namedCollectionLockNames(database, slugs);
  const taken: string[] = [];
  // In the reverse of the order taken, each once.
  const release = async (): Promise<void> => {
    for (const name of taken.splice(0).reverse()) {
      await tx.queryStatement(sql`SELECT RELEASE_LOCK(${name})`);
    }
  };
  try {
    for (const name of names) {
      const [row] = await tx.queryStatement<{ locked: unknown }>(
        sql`SELECT GET_LOCK(${name}, ${NAMED_LOCK_WAIT_SECONDS}) AS ${sql.identifier("locked")}`
      );
      if (Number(row?.locked) !== 1) {
        throw NextlyError.conflict({
          message:
            "This collection is being changed elsewhere. Try again in a moment.",
          logContext: { reason: "collection-named-lock-timeout", lock: name },
        });
      }
      taken.push(name);
    }
  } catch (error) {
    await release();
    throw error;
  }
  return { release };
}
