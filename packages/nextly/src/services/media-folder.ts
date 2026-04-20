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

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";

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
  message: string;
  data?: MediaFolder | null;
}

export interface FolderListResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data?: MediaFolder[];
}

export interface FolderContentsResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data?: FolderContents;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parent = await (this.db as any)
          .select()
          .from(mediaFolders)
          .where(eq(mediaFolders.id, input.parentId))
          .limit(1);

        if (!parent || parent.length === 0) {
          return {
            success: false,
            statusCode: 404,
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (this.db as any)
        .select()
        .from(mediaFolders)
        .where(existingQuery)
        .limit(1);

      if (existing && existing.length > 0) {
        return {
          success: false,
          statusCode: 409,
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

      await (this.db as any).insert(mediaFolders).values(folderData);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [folder] = await (this.db as any)
        .select()
        .from(mediaFolders)
        .where(eq(mediaFolders.id, folderId))
        .limit(1);

      if (!folder) {
        return {
          success: false,
          statusCode: 404,
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const folders = await (this.db as any)
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

      const folders = await (this.db as any)
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
      const { mediaFolders, media } = this.tables;
      const folderSchemaAvailable = this.hasFolderSchema();

      let folder: MediaFolder | null = null;
      if (folderId) {
        if (!folderSchemaAvailable) {
          return {
            success: false,
            statusCode: 404,
            message: "Folder not found",
          };
        }

        const folderResult = await this.getFolderById(folderId);
        if (!folderResult.success || !folderResult.data) {
          return {
            success: false,
            statusCode: 404,
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
        ? await (this.db as any)
            .select()
            .from(media)
            .where(
              folderId ? eq(media.folderId, folderId) : isNull(media.folderId)
            )
            .orderBy(media.uploadedAt)
        : await (this.db as any).select().from(media).orderBy(media.uploadedAt);

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
            message: "Cannot move folder into itself",
            data: null,
          };
        }

        const isSubfolder = await this.isSubfolder(folderId, updates.parentId);
        if (isSubfolder) {
          return {
            success: false,
            statusCode: 400,
            message: "Cannot move folder into its own subfolder",
            data: null,
          };
        }
      }

      const updateData: Record<string, unknown> = {
        ...updates,
        updatedAt: new Date(),
      };

      await (this.db as any)
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
    storage?: {
      bulkDelete(
        filePaths: string[],
        collection?: string
      ): Promise<{
        successful: string[];
        failed: Array<{ filePath: string; error: string }>;
      }>;
    }
  ): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    deletedMedia?: number;
    deletedFolders?: number;
  }> {
    try {
      const { mediaFolders, media } = this.tables;

      const existing = await this.getFolderById(folderId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          statusCode: 404,
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
            message:
              "Folder is not empty. Set deleteContents=true to delete all contents.",
          };
        }
      }

      let deletedMediaCount = 0;
      let deletedFoldersCount = 0;

      if (deleteContents) {
        const subfolderIds = await this.collectAllSubfolderIds(folderId);
        const allFolderIds = [folderId, ...subfolderIds];
        deletedFoldersCount = subfolderIds.length;

        const allMediaRecords: Array<{
          id: string;
          filename: string;
          thumbnailUrl: string | null;
        }> = [];

        for (const fId of allFolderIds) {
          const mediaInFolder = await (this.db as any)
            .select({
              id: media.id,
              filename: media.filename,
              thumbnailUrl: media.thumbnailUrl,
            })
            .from(media)
            .where(eq(media.folderId, fId));

          allMediaRecords.push(...mediaInFolder);
        }

        deletedMediaCount = allMediaRecords.length;

        if (storage && allMediaRecords.length > 0) {
          const filePaths: string[] = [];
          for (const record of allMediaRecords) {
            if (record.filename) filePaths.push(record.filename);
            if (record.thumbnailUrl) filePaths.push(record.thumbnailUrl);
          }

          if (filePaths.length > 0) {
            try {
              await storage.bulkDelete(filePaths);
            } catch (storageError) {
              console.error(
                "[MediaFolderService] Storage deletion error (continuing with DB deletion):",
                storageError
              );
            }
          }
        }

        if (allMediaRecords.length > 0) {
          const mediaIds = allMediaRecords.map(r => r.id);
          const chunkSize = 100;
          for (let i = 0; i < mediaIds.length; i += chunkSize) {
            const chunk = mediaIds.slice(i, i + chunkSize);
            await (this.db as any).delete(media).where(
              sql`${media.id} IN (${sql.join(
                chunk.map(id => sql`${id}`),
                sql`, `
              )})`
            );
          }
        }
      }

      // Delete folder (CASCADE handles subfolder records)
      await (this.db as any)
        .delete(mediaFolders)
        .where(eq(mediaFolders.id, folderId));

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
        message: "Failed to delete folder",
      };
    }
  }

  /**
   * Move media file to folder
   */
  async moveMediaToFolder(
    mediaId: string,
    folderId: string | null
  ): Promise<{ success: boolean; statusCode: number; message: string }> {
    try {
      const { media } = this.tables;

      if (folderId) {
        const folderResult = await this.getFolderById(folderId);
        if (!folderResult.success) {
          return {
            success: false,
            statusCode: 404,
            message: "Folder not found",
          };
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any)
        .update(media)
        .set({ folderId, updatedAt: new Date() })
        .where(eq(media.id, mediaId));

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
        message: "Failed to move media",
      };
    }
  }
}
