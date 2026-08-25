/**
 * Media Folder Service
 *
 * Handles CRUD operations for media folder organization with nested hierarchy support.
 *
 * Features:
 * - Create/read/update/delete folders
 * - Nested folder hierarchy (subfolders)
 * - Move media files between folders
 * - List folder contents (subfolders + media files)
 * - Breadcrumb navigation support
 *
 * @example
 * ```typescript
 * const folderService = new MediaFolderService(adapter, logger);
 *
 * // Create a folder
 * const result = await folderService.createFolder({
 *   name: 'Product Images',
 *   description: 'All product photos',
 *   createdBy: userId,
 * });
 *
 * // Create a subfolder
 * await folderService.createFolder({
 *   name: 'Electronics',
 *   parentId: productImagesId,
 *   createdBy: userId,
 * });
 *
 * // Move media to folder
 * await folderService.moveMediaToFolder(mediaId, folderId);
 * ```
 */

import crypto from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../domains/media/revalidate-media";
import type { ServiceErrorCode } from "../errors/error-codes";

import { BaseService } from "./base-service";
import type { Logger } from "./shared";

export interface MediaFolder {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFolderInput {
  name: string;
  description?: string;
  parentId?: string;
  createdBy: string;
}

export interface UpdateFolderInput {
  name?: string;
  description?: string;
  parentId?: string;
}

export interface FolderContents {
  folder: MediaFolder;
  subfolders: MediaFolder[];
  mediaFiles: Record<string, unknown>[];
  breadcrumbs: Array<{ id: string; name: string }>;
}

export interface FolderResponse {
  success: boolean;
  statusCode: number;
  code?: ServiceErrorCode;
  message: string;
  data?: MediaFolder | null;
}

export interface FolderListResponse {
  code?: ServiceErrorCode;
  success: boolean;
  statusCode: number;
  message: string;
  data?: MediaFolder[];
}

export interface FolderContentsResponse {
  code?: ServiceErrorCode;
  success: boolean;
  statusCode: number;
  message: string;
  data?: FolderContents;
}

/**
 * The shape `deleteFolder` reports.
 *
 * Named rather than written inline, because the wrapper that opens the
 * invalidation batch and the method it delegates to must agree on it exactly.
 */
interface DeleteFolderOutcome {
  success: boolean;
  statusCode: number;
  code?: ServiceErrorCode;
  message: string;
  deletedMedia?: number;
  deletedFolders?: number;
}

/** The columns a cascading delete needs from each media row. */
interface StoredMediaRecord {
  id: string;
  filename: string;
  thumbnailUrl: string | null;
}

/** The storage surface a cascading folder delete uses, injected by the caller. */
interface FolderStorageCleanup {
  bulkDelete(
    filePaths: string[],
    collection?: string
  ): Promise<{
    successful: string[];
    failed: Array<{ filePath: string; error: string }>;
  }>;
}

export class MediaFolderService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  private hasFolderSchema(): boolean {
    const mediaFolders = (this.tables as Record<string, unknown>).mediaFolders;
    const media = (this.tables as Record<string, unknown>).media;
    const mediaFolderId =
      media && typeof media === "object"
        ? (media as Record<string, unknown>).folderId
        : undefined;

    return Boolean(mediaFolders && mediaFolderId);
  }

  /**
   * Create a new folder
   */
  async createFolder(input: CreateFolderInput): Promise<FolderResponse> {
    try {
      const { mediaFolders } = this.tables;

      if (input.parentId) {
        const parent = await this.db
          .select()
          .from(mediaFolders)
          .where(eq(mediaFolders.id, input.parentId))
          .limit(1);

        if (!parent || parent.length === 0) {
          return {
            success: false,
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Parent folder not found",
            data: null,
          };
        }
      }

      const existingQuery = input.parentId
        ? and(
            eq(mediaFolders.name, input.name),
            eq(mediaFolders.parentId, input.parentId)
          )
        : and(eq(mediaFolders.name, input.name), isNull(mediaFolders.parentId));

      const existing = await this.db
        .select()
        .from(mediaFolders)
        .where(existingQuery)
        .limit(1);

      if (existing && existing.length > 0) {
        return {
          success: false,
          statusCode: 409,
          // The service names its own meaning. 409 covers both a name clash and
          // a stale write, so a boundary inferring from the status alone has to
          // pick the safer reading -- which would tell someone whose folder
          // name is taken to refresh the page, advice that cannot rename
          // anything.
          code: "DUPLICATE",
          message: "A folder with this name already exists in this location",
          data: null,
        };
      }

      const folderId = crypto.randomUUID();
      const now = new Date();

      const folderData = {
        id: folderId,
        name: input.name,
        description: input.description || null,
        parentId: input.parentId || null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.insert(mediaFolders).values(folderData);

      return {
        success: true,
        statusCode: 201,
        message: "Folder created successfully",
        data: folderData as unknown as MediaFolder,
      };
    } catch (error) {
      console.error("[MediaFolderService] Create folder error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to create folder",
        data: null,
      };
    }
  }

  /**
   * Get folder by ID
   */
  async getFolderById(folderId: string): Promise<FolderResponse> {
    try {
      const { mediaFolders } = this.tables;

      const [folder] = await this.db
        .select()
        .from(mediaFolders)
        .where(eq(mediaFolders.id, folderId))
        .limit(1);

      if (!folder) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Folder not found",
          data: null,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "Folder retrieved successfully",
        data: folder,
      };
    } catch (error) {
      console.error("[MediaFolderService] Get folder error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to retrieve folder",
        data: null,
      };
    }
  }

  /**
   * List root folders (no parent)
   */
  async listRootFolders(createdBy?: string): Promise<FolderListResponse> {
    try {
      const { mediaFolders } = this.tables;

      if (!this.hasFolderSchema()) {
        return {
          success: true,
          statusCode: 200,
          message: "Root folders retrieved successfully",
          data: [],
        };
      }

      const conditions = [isNull(mediaFolders.parentId)];
      if (createdBy) {
        conditions.push(eq(mediaFolders.createdBy, createdBy));
      }

      const folders = await this.db
        .select()
        .from(mediaFolders)
        .where(and(...conditions))
        .orderBy(mediaFolders.name);

      return {
        success: true,
        statusCode: 200,
        message: "Root folders retrieved successfully",
        data: folders,
      };
    } catch (error) {
      console.error("[MediaFolderService] List root folders error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to retrieve root folders",
        data: [],
      };
    }
  }

  /**
   * List subfolders of a folder
   */
  async listSubfolders(parentId: string): Promise<FolderListResponse> {
    try {
      const { mediaFolders } = this.tables;

      if (!this.hasFolderSchema()) {
        return {
          success: true,
          statusCode: 200,
          message: "Subfolders retrieved successfully",
          data: [],
        };
      }

      const folders = await this.db
        .select()
        .from(mediaFolders)
        .where(eq(mediaFolders.parentId, parentId))
        .orderBy(mediaFolders.name);

      return {
        success: true,
        statusCode: 200,
        message: "Subfolders retrieved successfully",
        data: folders,
      };
    } catch (error) {
      console.error("[MediaFolderService] List subfolders error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to retrieve subfolders",
        data: [],
      };
    }
  }

  /**
   * Get folder contents (subfolders + media files)
   */
  async getFolderContents(
    folderId: string | null
  ): Promise<FolderContentsResponse> {
    try {
      const { mediaFolders: _mediaFolders, media } = this.tables;
      const folderSchemaAvailable = this.hasFolderSchema();

      let folder: MediaFolder | null = null;
      if (folderId) {
        if (!folderSchemaAvailable) {
          return {
            success: false,
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Folder not found",
          };
        }

        const folderResult = await this.getFolderById(folderId);
        if (!folderResult.success || !folderResult.data) {
          return {
            success: false,
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Folder not found",
          };
        }
        folder = folderResult.data;
      }

      const subfoldersResult = folderId
        ? await this.listSubfolders(folderId)
        : await this.listRootFolders();

      const subfolders = subfoldersResult.data || [];

      const mediaFiles = folderSchemaAvailable
        ? await this.db
            .select()
            .from(media)
            .where(
              folderId ? eq(media.folderId, folderId) : isNull(media.folderId)
            )
            .orderBy(media.uploadedAt)
        : await this.db.select().from(media).orderBy(media.uploadedAt);

      const breadcrumbs = await this.getBreadcrumbs(folderId);

      return {
        success: true,
        statusCode: 200,
        message: "Folder contents retrieved successfully",
        data: {
          folder: folder || {
            id: "root",
            name: "Media Library",
            description: null,
            parentId: null,
            createdBy: "",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          subfolders,
          mediaFiles,
          breadcrumbs,
        },
      };
    } catch (error) {
      console.error("[MediaFolderService] Get folder contents error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to retrieve folder contents",
      };
    }
  }

  private async getBreadcrumbs(
    folderId: string | null
  ): Promise<Array<{ id: string; name: string }>> {
    if (!folderId) {
      return [{ id: "root", name: "Media Library" }];
    }

    const breadcrumbs: Array<{ id: string; name: string }> = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const folderResult = await this.getFolderById(currentId);
      if (!folderResult.success || !folderResult.data) break;

      breadcrumbs.unshift({
        id: folderResult.data.id,
        name: folderResult.data.name,
      });

      currentId = folderResult.data.parentId;
    }

    breadcrumbs.unshift({ id: "root", name: "Media Library" });
    return breadcrumbs;
  }

  /**
   * Update folder
   */
  async updateFolder(
    folderId: string,
    updates: UpdateFolderInput
  ): Promise<FolderResponse> {
    try {
      const { mediaFolders } = this.tables;

      const existing = await this.getFolderById(folderId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Folder not found",
          data: null,
        };
      }

      // Prevent moving folder into itself or its own subfolder
      if (updates.parentId) {
        if (updates.parentId === folderId) {
          return {
            success: false,
            statusCode: 400,
            code: "INVALID_INPUT",
            message: "Cannot move folder into itself",
            data: null,
          };
        }

        const isSubfolder = await this.isSubfolder(folderId, updates.parentId);
        if (isSubfolder) {
          return {
            success: false,
            statusCode: 400,
            code: "INVALID_INPUT",
            message: "Cannot move folder into its own subfolder",
            data: null,
          };
        }
      }

      const updateData: Record<string, unknown> = {
        ...updates,
        updatedAt: new Date(),
      };

      await this.db
        .update(mediaFolders)
        .set(updateData)
        .where(eq(mediaFolders.id, folderId));

      return {
        success: true,
        statusCode: 200,
        message: "Folder updated successfully",
        data: {
          ...existing.data,
          ...updates,
          updatedAt: updateData.updatedAt,
        } as unknown as MediaFolder,
      };
    } catch (error) {
      console.error("[MediaFolderService] Update folder error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to update folder",
        data: null,
      };
    }
  }

  private async isSubfolder(
    folder1Id: string,
    folder2Id: string
  ): Promise<boolean> {
    let currentId: string | null = folder2Id;

    while (currentId) {
      if (currentId === folder1Id) return true;

      const folderResult = await this.getFolderById(currentId);
      if (!folderResult.success || !folderResult.data) break;

      currentId = folderResult.data.parentId;
    }

    return false;
  }

  private async collectAllSubfolderIds(folderId: string): Promise<string[]> {
    const allIds: string[] = [];
    const queue: string[] = [folderId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const subfoldersResult = await this.listSubfolders(currentId);
      if (subfoldersResult.data) {
        for (const sub of subfoldersResult.data) {
          allIds.push(sub.id);
          queue.push(sub.id);
        }
      }
    }

    return allIds;
  }

  /**
   * Delete folder (and optionally its contents)
   */
  async deleteFolder(
    folderId: string,
    deleteContents: boolean = false,
    storage?: FolderStorageCleanup
  ): Promise<DeleteFolderOutcome> {
    try {
      const { mediaFolders } = this.tables;

      const existing = await this.getFolderById(folderId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Folder not found",
        };
      }

      const contents = await this.getFolderContents(folderId);
      if (contents.data) {
        const hasContents =
          contents.data.subfolders.length > 0 ||
          contents.data.mediaFiles.length > 0;

        if (hasContents && !deleteContents) {
          return {
            success: false,
            statusCode: 400,
            code: "INVALID_INPUT",
            message:
              "Folder is not empty. Set deleteContents=true to delete all contents.",
          };
        }
      }

      let deletedMediaCount = 0;
      let deletedFoldersCount = 0;
      if (deleteContents) {
        const subfolderIds = await this.collectAllSubfolderIds(folderId);
        deletedFoldersCount = subfolderIds.length;

        const records = await this.collectMediaInFolders([
          folderId,
          ...subfolderIds,
        ]);
        deletedMediaCount = records.length;

        // ONE shared-tag flush for a delete that commits in chunks. Each
        // chunk busts its own rows' tags as it commits; this scope holds only
        // `nextly:media`, the string every row emits, so a folder of several
        // hundred files does not re-invalidate it once per chunk.
        //
        // Scoped to the media fan-out rather than the whole method: the
        // validation above and the folder-row delete below emit no media tags,
        // and holding the shared one across them would defer it behind work
        // that has nothing to do with it.
        await withMediaRevalidationBatch(async () => {
          if (storage) await this.removeStoredFiles(records, storage);
          await this.deleteMediaRowsInChunks(records.map(r => r.id));
        });
      }

      // Delete folder (CASCADE handles subfolder records)
      await this.db.delete(mediaFolders).where(eq(mediaFolders.id, folderId));

      return {
        success: true,
        statusCode: 200,
        message: "Folder deleted successfully",
        deletedMedia: deletedMediaCount,
        deletedFolders: deletedFoldersCount,
      };
    } catch (error) {
      console.error("[MediaFolderService] Delete folder error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to delete folder",
      };
    }
  }

  /** Every media row held by any of these folders. */
  private async collectMediaInFolders(
    folderIds: string[]
  ): Promise<StoredMediaRecord[]> {
    const { media } = this.tables;
    const records: StoredMediaRecord[] = [];
    for (const folderId of folderIds) {
      const inFolder = await this.db
        .select({
          id: media.id,
          filename: media.filename,
          thumbnailUrl: media.thumbnailUrl,
        })
        .from(media)
        .where(eq(media.folderId, folderId));
      records.push(...inFolder);
    }
    return records;
  }

  /**
   * Best-effort physical cleanup, ahead of the row deletes.
   *
   * Swallow-and-warn: a storage failure must not stop the rows being removed.
   * The row is the authoritative record, and leaving it behind because a file
   * could not be unlinked strands a folder nobody can delete.
   */
  private async removeStoredFiles(
    records: StoredMediaRecord[],
    storage: FolderStorageCleanup
  ): Promise<void> {
    const filePaths: string[] = [];
    for (const record of records) {
      if (record.filename) filePaths.push(record.filename);
      if (record.thumbnailUrl) filePaths.push(record.thumbnailUrl);
    }
    if (filePaths.length === 0) return;

    try {
      await storage.bulkDelete(filePaths);
    } catch (storageError) {
      console.error(
        "[MediaFolderService] Storage deletion error (continuing with DB deletion):",
        storageError
      );
    }
  }

  /**
   * Remove the rows in chunks, busting each chunk's cache tags as it commits.
   *
   * There is no encompassing transaction here, so an earlier chunk is already
   * durable when a later one throws or the process is killed. Holding its tags
   * until the end would leave those files cached with no row behind them; the
   * shared collection tag is still paid once, by the scope the caller opened.
   */
  private async deleteMediaRowsInChunks(mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    const { media } = this.tables;
    const chunkSize = 100;

    for (let i = 0; i < mediaIds.length; i += chunkSize) {
      const chunk = mediaIds.slice(i, i + chunkSize);
      await this.db.delete(media).where(
        sql`${media.id} IN (${sql.join(
          chunk.map(id => sql`${id}`),
          sql`, `
        )})`
      );
      // After the statement, so this only ever names rows that are gone.
      await revalidateMedia(chunk);
    }
  }

  /**
   * Move media file to folder
   */
  async moveMediaToFolder(
    mediaId: string,
    folderId: string | null
  ): Promise<{
    success: boolean;
    statusCode: number;
    code?: ServiceErrorCode;
    message: string;
  }> {
    try {
      const { media } = this.tables;

      if (folderId) {
        const folderResult = await this.getFolderById(folderId);
        if (!folderResult.success) {
          return {
            success: false,
            statusCode: 404,
            code: "NOT_FOUND",
            message: "Folder not found",
          };
        }
      }

      await this.db
        .update(media)
        .set({ folderId, updatedAt: new Date() })
        .where(eq(media.id, mediaId));

      // A direct media-row write that never reaches the media service, so it
      // carries its own invalidation for the same reason the cascade above does.
      await revalidateMedia([mediaId]);

      return {
        success: true,
        statusCode: 200,
        message: folderId
          ? "Media moved to folder successfully"
          : "Media moved to root successfully",
      };
    } catch (error) {
      console.error("[MediaFolderService] Move media error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to move media",
      };
    }
  }
}
