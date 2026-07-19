import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, and, or, like, asc, desc, count } from "drizzle-orm";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { MigrationStatus } from "../../../schemas/dynamic-collections/types";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

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
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    useAsTitle?: string;
    order?: number;
    sidebarGroup?: string;
    isPlugin?: boolean;
    disableCreate?: boolean;
    pagination?: { defaultLimit?: number; limits?: number[] };
  };
  source?: "code" | "ui" | "built-in";
  locked?: boolean;
  configPath?: string;
  schemaHash: string;
  schemaVersion?: number;
  migrationStatus?: MigrationStatus;
  lastMigrationId?: string;
  accessRules?: {
    create?: { type: string; allowedRoles?: string[] };
    read?: { type: string; allowedRoles?: string[] };
    update?: { type: string; allowedRoles?: string[] };
    delete?: { type: string; allowedRoles?: string[] };
  };
  hooks?: Record<string, unknown>[];
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

    await this.db.insert(this.dynamicCollections).values({
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
      configPath: metadata.configPath,
      schemaHash: metadata.schemaHash,
      schemaVersion: metadata.schemaVersion ?? 1,
      migrationStatus: metadata.migrationStatus ?? "pending",
      lastMigrationId: metadata.lastMigrationId,
      accessRules: metadata.accessRules,
      hooks: metadata.hooks,
      createdBy: metadata.createdBy,
    });

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
      })
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, collectionSlug))
      .limit(1);

    if (existing.length === 0) {
      throw new Error(`Collection "${collectionSlug}" not found`);
    }

    const targetSlug = updates.slug ?? existing[0].slug;
    await this.ensureGlobalSlugUniqueness(targetSlug, {
      currentCollectionId: existing[0].id,
    });

    const updateData: Record<string, unknown> = { ...updates };

    delete updateData.id;

    updateData.updatedAt = new Date();

    await this.db
      .update(this.dynamicCollections)
      .set(updateData)
      .where(eq(this.dynamicCollections.slug, collectionSlug));

    return this.getCollection(collectionSlug);
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
    } = options || {};

    const conditions = [];

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          like(this.dynamicCollections.slug, searchPattern),
          like(this.dynamicCollections.description, searchPattern)
        )
      );
    }

    if (source) {
      conditions.push(eq(this.dynamicCollections.source, source));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderFn = sortOrder === "asc" ? asc : desc;
    let orderByClause;
    switch (sortBy) {
      // "name" is the admin/API alias for "slug" — both sort on the slug column.
      case "name":
      case "slug":
        orderByClause = orderFn(this.dynamicCollections.slug);
        break;
      case "updatedAt":
        orderByClause = orderFn(this.dynamicCollections.updatedAt);
        break;
      case "createdAt":
      default:
        orderByClause = orderFn(this.dynamicCollections.createdAt);
    }

    const offset = (page - 1) * limit;

    const countResult = await this.db
      .select({ value: count() })
      .from(this.dynamicCollections)
      .where(whereClause);

    const total = Number(countResult[0]?.value ?? 0);
    const totalPages = Math.ceil(total / limit);

    const collections = includeSchema
      ? await this.db
          .select()
          .from(this.dynamicCollections)
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset)
      : await this.db
          .select({
            id: this.dynamicCollections.id,
            slug: this.dynamicCollections.slug,
            tableName: this.dynamicCollections.tableName,
            description: this.dynamicCollections.description,
            labels: this.dynamicCollections.labels,
            timestamps: this.dynamicCollections.timestamps,
            admin: this.dynamicCollections.admin,
            source: this.dynamicCollections.source,
            locked: this.dynamicCollections.locked,
            schemaVersion: this.dynamicCollections.schemaVersion,
            migrationStatus: this.dynamicCollections.migrationStatus,
            createdBy: this.dynamicCollections.createdBy,
            createdAt: this.dynamicCollections.createdAt,
            updatedAt: this.dynamicCollections.updatedAt,
            // fields is intentionally excluded for performance
          })
          .from(this.dynamicCollections)
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset);

    return {
      collections,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getCollection(slug: string): Promise<unknown> {
    const result = await this.db
      .select()
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug))
      .limit(1);

    if (result.length === 0) {
      throw new Error(`Collection "${slug}" not found`);
    }

    const row = result[0] as Record<string, unknown>;
    // Why: SQLite returns `status` as 0|1 even with `mode: "boolean"` in some
    // driver/dialect combinations; postgres returns native boolean. Coerce
    // here so the API contract is dialect-agnostic and the admin's
    // `collection.status === true` gate works everywhere.
    return {
      ...row,
      status: row.status === 1 || row.status === true,
    };
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
    await this.db
      .delete(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug));
  }
}
