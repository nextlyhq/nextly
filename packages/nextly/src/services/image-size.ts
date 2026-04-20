/**
 * Image Size Service
 *
 * CRUD operations for named image size configurations.
 * Supports both code-first (synced from nextly.config.ts) and
 * Visual (managed in admin Settings) approaches.
 *
 * Code-first config wins on conflict (same name, different settings).
 * UI-created sizes are kept as-is during sync.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import type { ImageSizeConfig } from "../storage/image-sizes";

import { BaseService } from "./base-service";
import type { Logger } from "./shared";

export interface ImageSize {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  fit: string;
  quality: number;
  format: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateImageSizeInput {
  name: string;
  width?: number | null;
  height?: number | null;
  fit?: string;
  quality?: number;
  format?: string;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface UpdateImageSizeInput {
  name?: string;
  width?: number | null;
  height?: number | null;
  fit?: string;
  quality?: number;
  format?: string;
  isDefault?: boolean;
  sortOrder?: number;
}

export class ImageSizeService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * List all image sizes, ordered by sortOrder.
   */
  async list(): Promise<ImageSize[]> {
    const { imageSizes } = this.tables;

    const rows = await this.db
      .select()
      .from(imageSizes)
      .orderBy(imageSizes.sortOrder);

    return rows as ImageSize[];
  }

  /**
   * Get active image sizes as ImageSizeConfig array (for generation pipeline).
   * Only returns sizes with isDefault: true.
   */
  async getActiveSizeConfigs(): Promise<ImageSizeConfig[]> {
    const { imageSizes } = this.tables;

    const rows = await this.db
      .select()
      .from(imageSizes)
      .where(eq(imageSizes.isDefault, true))
      .orderBy(imageSizes.sortOrder);

    return rows.map((row: any) => ({
      name: row.name,
      width: row.width,
      height: row.height,
      fit: row.fit as ImageSizeConfig["fit"],
      quality: row.quality,
      format: row.format as ImageSizeConfig["format"],
    }));
  }

  /**
   * Get a single image size by name.
   */
  async getByName(name: string): Promise<ImageSize | null> {
    const { imageSizes } = this.tables;

    const rows = await this.db
      .select()
      .from(imageSizes)
      .where(eq(imageSizes.name, name))
      .limit(1);

    return (rows[0] as ImageSize) ?? null;
  }

  /**
   * Get a single image size by ID.
   */
  async getById(id: string): Promise<ImageSize | null> {
    const { imageSizes } = this.tables;

    const rows = await this.db
      .select()
      .from(imageSizes)
      .where(eq(imageSizes.id, id))
      .limit(1);

    return (rows[0] as ImageSize) ?? null;
  }

  /**
   * Create a new image size.
   * Throws if a size with the same name already exists.
   */
  async create(input: CreateImageSizeInput): Promise<ImageSize> {
    const existing = await this.getByName(input.name);
    if (existing) {
      throw new Error(`Image size "${input.name}" already exists`);
    }

    const now = new Date();
    const id = crypto.randomUUID();

    const data = {
      id,
      name: input.name,
      width: input.width ?? null,
      height: input.height ?? null,
      fit: input.fit ?? "inside",
      quality: input.quality ?? 80,
      format: input.format ?? "auto",
      isDefault: input.isDefault ?? true,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    const { imageSizes } = this.tables;
    await this.db.insert(imageSizes).values(data);

    return data as ImageSize;
  }

  /**
   * Update an existing image size by ID.
   */
  async update(id: string, input: UpdateImageSizeInput): Promise<ImageSize> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Image size not found: ${id}`);
    }

    // Check for duplicate name if name is being changed
    if (input.name && input.name !== existing.name) {
      const nameConflict = await this.getByName(input.name);
      if (nameConflict) {
        throw new Error(`Image size "${input.name}" already exists`);
      }
    }

    const { imageSizes } = this.tables;
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.width !== undefined) updateData.width = input.width;
    if (input.height !== undefined) updateData.height = input.height;
    if (input.fit !== undefined) updateData.fit = input.fit;
    if (input.quality !== undefined) updateData.quality = input.quality;
    if (input.format !== undefined) updateData.format = input.format;
    if (input.isDefault !== undefined) updateData.isDefault = input.isDefault;
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;

    await this.db
      .update(imageSizes)
      .set(updateData)
      .where(eq(imageSizes.id, id));

    return { ...existing, ...updateData } as ImageSize;
  }

  /**
   * Delete an image size by ID.
   */
  async delete(id: string): Promise<void> {
    const { imageSizes } = this.tables;
    await this.db.delete(imageSizes).where(eq(imageSizes.id, id));
  }

  /**
   * Sync image sizes from code config to database.
   *
   * Rules:
   * 1. Code-defined sizes → upsert (code wins on conflict)
   * 2. DB-only sizes (UI-created) → kept as-is
   * 3. Previously code-defined sizes removed from config → mark isDefault: false
   *
   * @param configSizes - Image sizes from nextly.config.ts
   */
  async syncFromConfig(configSizes: ImageSizeConfig[]): Promise<void> {
    const { imageSizes } = this.tables;

    const dbSizes = await this.list();
    const dbSizesByName = new Map(dbSizes.map(s => [s.name, s]));
    const configNames = new Set(configSizes.map(s => s.name));

    for (let i = 0; i < configSizes.length; i++) {
      const config = configSizes[i];
      const existing = dbSizesByName.get(config.name);

      const sizeData = {
        name: config.name,
        width: config.width ?? null,
        height: config.height ?? null,
        fit: config.fit ?? "inside",
        quality: config.quality ?? 80,
        format: config.format ?? "auto",
        isDefault: true,
        sortOrder: i,
        updatedAt: new Date(),
      };

      if (existing) {
        // Update existing to match code config (code wins)
        await this.db
          .update(imageSizes)
          .set(sizeData)
          .where(eq(imageSizes.id, existing.id));
      } else {
        // Insert new size from config
        await this.db.insert(imageSizes).values({
          id: crypto.randomUUID(),
          ...sizeData,
          createdAt: new Date(),
        });
      }
    }

    // Mark sizes removed from config as non-default
    // (only if they were previously code-defined, i.e. isDefault: true)
    for (const dbSize of dbSizes) {
      if (dbSize.isDefault && !configNames.has(dbSize.name)) {
        await this.db
          .update(imageSizes)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(imageSizes.id, dbSize.id));
      }
    }
  }
}
