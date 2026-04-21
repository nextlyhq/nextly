import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
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
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    useAsTitle?: string;
    order?: number;
    sidebarGroup?: string;
    isPlugin?: boolean;
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
  pageSize?: number;
  search?: string;
  sortBy?: "slug" | "createdAt" | "updatedAt";
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
  pageSize: number;
  totalPages: number;
}

export class DynamicCollectionRegistryService extends BaseService {
   
  private dynamicCollections: any;
   
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
     
    const existingCollection = await (this.db as any)
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

     
    const existingSingle = await (this.db as any)
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

     
    await (this.db as any).insert(this.dynamicCollections).values({
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
     
    const existing = await (this.db as any)
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

     
    await (this.db as any)
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
      pageSize = 10,
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

    const offset = (page - 1) * pageSize;

     
    const countResult = await (this.db as any)
      .select({ value: count() })
      .from(this.dynamicCollections)
      .where(whereClause);

    const total = Number(countResult[0]?.value ?? 0);
    const totalPages = Math.ceil(total / pageSize);

    const collections = includeSchema
      ?  
        await (this.db as any)
          .select()
          .from(this.dynamicCollections)
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset)
      :  
        await (this.db as any)
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
          .limit(pageSize)
          .offset(offset);

    return {
      collections,
      total,
      page,
      pageSize,
      totalPages,
    } as ListCollectionsResponse<TIncludeSchema>;
  }

  async getCollection(slug: string): Promise<unknown> {
     
    const result = await (this.db as any)
      .select()
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug))
      .limit(1);

    if (result.length === 0) {
      throw new Error(`Collection "${slug}" not found`);
    }

    return result[0];
  }

  async collectionExists(slug: string): Promise<boolean> {
     
    const result = await (this.db as any)
      .select({ id: this.dynamicCollections.id })
      .from(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug))
      .limit(1);

    return result.length > 0;
  }

  async unregisterCollection(slug: string): Promise<void> {
     
    await (this.db as any)
      .delete(this.dynamicCollections)
      .where(eq(this.dynamicCollections.slug, slug));
  }
}
