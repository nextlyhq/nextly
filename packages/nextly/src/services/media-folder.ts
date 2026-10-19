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
import { and, eq, isNull } from "drizzle-orm";

import { getMediaStorage } from "@nextly/storage";

import {
  errorForLog,
  filesKeptByOthers,
  removeStoredFiles,
  storedPathForLog,
  warnUnlocated,
} from "../domains/media/remove-stored-files";
import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../domains/media/revalidate-media";
import {
  storedFilesOf,
  type MediaFilesRecord,
} from "../domains/media/stored-files";
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
type StoredMediaRecord = MediaFilesRecord & { id: string };

/**
 * Removes the stored files of media rows a cascading folder delete removed,
 * once they are gone. Never throws.
 */
type RemoveStoredFiles = (
  records: StoredMediaRecord[],
  /** Files another item still refers to, which stay. */
  kept: ReadonlySet<string>
) => Promise<void>;

/**
 * Every file of each item, as a delete of that item removes them, one item
 * at a time: a chunk of a hundred items asked for all at once would send the
 * storage every file of every item together, and a refused or throttled
 * request leaves its file stored.
 */
const removeEveryStoredFile: RemoveStoredFiles = async (records, kept) => {
  const storage = getMediaStorage();
  for (const record of records) {
    await removeStoredFiles(storage, record, record.id, kept);
  }
};

/**
 * Storage a caller hands a cascading folder delete, as the cleanup argument
 * has taken it before: given every stored file of the items removed.
 */
interface FolderStorageCleanup {
  bulkDelete(
    filePaths: string[],
    collection?: string
  ): Promise<{
    successful: string[];
    failed: Array<{ filePath: string; error: string }>;
  }>;
}

/** The removal a cascading folder delete runs, from what its caller gave. */
function removalFrom(
  cleanup: RemoveStoredFiles | FolderStorageCleanup | undefined
): RemoveStoredFiles {
  if (cleanup === undefined) return removeEveryStoredFile;
  if (typeof cleanup === "function") {
    // The rows are already gone: a failure is named, never thrown, so it
    // cannot stop the rest of the cascade.
    return async (records, kept) => {
      try {
        await cleanup(records, kept);
      } catch (error) {
        console.warn(
          "[MediaFolderService] Could not remove the files of the deleted items:",
          errorForLog(error)
        );
      }
    };
  }
  return async (records, kept) => {
    const filePaths: string[] = [];
    for (const record of records) {
      const { paths, unlocated } = storedFilesOf(record);
      filePaths.push(...paths.filter(filePath => !kept.has(filePath)));
      for (const url of unlocated) warnUnlocated(url, record.id);
    }
    if (filePaths.length === 0) return;
    // The rows are already gone: a storage failure is named, never thrown.
    try {
      const { failed } = await cleanup.bulkDelete(filePaths, "media");
      for (const { filePath, error } of failed) {
        console.warn(
          `[MediaFolderService] Could not remove ${storedPathForLog(filePath)}: ${errorForLog(new Error(error))}`
        );
      }
    } catch (error) {
      console.warn(
        "[MediaFolderService] Could not remove the files of the deleted items:",
        errorForLog(error)
      );
    }
  };
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
  /**
   * The reasons this folder may not be deleted, or null to proceed.
   *
   * A PRECONDITION, so it runs before any of the work below: refusing after
   * the media rows are gone would report failure on a delete that already
   * happened.
   */
  private async refuseUndeletableFolder(
    folderId: string,
    deleteContents: boolean
  ): Promise<DeleteFolderOutcome | null> {
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
    const hasContents =
      (contents.data?.subfolders.length ?? 0) > 0 ||
      (contents.data?.mediaFiles.length ?? 0) > 0;

    if (hasContents && !deleteContents) {
      return {
        success: false,
        statusCode: 400,
        code: "INVALID_INPUT",
        message:
          "Folder is not empty. Set deleteContents=true to delete all contents.",
      };
    }

    return null;
  }

  async deleteFolder(
    folderId: string,
    deleteContents: boolean = false,
    /**
     * How the deleted items' stored files are removed: every one of them
     * through the media storage by default. Storage with `bulkDelete` is
     * given their paths.
     */
    cleanup?: RemoveStoredFiles | FolderStorageCleanup
  ): Promise<DeleteFolderOutcome> {
    const removeFiles = removalFrom(cleanup);
    try {
      const { mediaFolders } = this.tables;

      const refusal = await this.refuseUndeletableFolder(
        folderId,
        deleteContents
      );
      if (refusal) return refusal;

      let deletedMediaCount = 0;
      let deletedFoldersCount = 0;
      // Hoisted: the folder delete below needs this list too, because
      // `media.folder_id` nulls on its parent's removal and any row still
      // pointing at one of these folders is changed by it.
      const subfolderIds = await this.collectAllSubfolderIds(folderId);
      const allFolderIds = [folderId, ...subfolderIds];

      if (deleteContents) {
        deletedFoldersCount = subfolderIds.length;

        const records = await this.collectMediaInFolders(allFolderIds);
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
        await withMediaRevalidationBatch(() =>
          this.deleteMediaRowsInChunks(
            records.map(record => record.id),
            removeFiles
          )
        );
      }

      // A file uploaded or moved INTO one of these folders after the
      // collection above is absent from `records`, and `media.folder_id` is
      // ON DELETE SET NULL — so the folder delete silently changes that row
      // while nothing busts its tags. Collected here, as close to the delete
      // as the code can get, because the gap otherwise spans the storage
      // cleanup and its retry backoffs.
      //
      // The DESCENDANT list is re-derived rather than reused: a folder created
      // under this one during that same gap is absent from the earlier
      // snapshot, the root delete cascades into it, and its media would be
      // re-parented with nothing naming it. Reusing the snapshot covers a file
      // added to a known folder and misses a file added to a new one.
      //
      // This NARROWS the window; it does not close it. A row arriving between
      // this query and the statement below is still missed, and closing that
      // needs the two to share a transaction or a lock on the folder rows,
      // which this method does not have.
      const currentFolderIds = [
        folderId,
        ...(await this.collectAllSubfolderIds(folderId)),
      ];
      const strays = await this.collectMediaInFolders(currentFolderIds);

      // Delete folder (CASCADE handles subfolder records)
      await this.db.delete(mediaFolders).where(eq(mediaFolders.id, folderId));

      // After the statement, so this only names rows the delete really changed,
      // and inside an enclosing SQLite transaction after that commits.
      if (strays.length > 0) {
        await this.afterCommit(() =>
          revalidateMedia(strays.map(record => record.id))
        );
      }

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

  /** The id of every media row held by any of these folders. */
  private async collectMediaInFolders(
    folderIds: string[]
  ): Promise<Array<{ id: string }>> {
    const { media } = this.tables;
    const records: Array<{ id: string }> = [];
    for (const folderId of folderIds) {
      const inFolder = await this.db
        .select({ id: media.id })
        .from(media)
        .where(eq(media.folderId, folderId));
      records.push(...inFolder);
    }
    return records;
  }

  /**
   * Remove the rows in chunks, busting each chunk's cache tags and removing
   * its items' stored files as it commits.
   *
   * There is no encompassing transaction here, so an earlier chunk is already
   * durable when a later one throws or the process is killed. Holding its tags
   * until the end would leave those files cached with no row behind them; the
   * shared collection tag is still paid once, by the scope the caller opened.
   * The files go only once their rows are gone, and inside an enclosing
   * SQLite transaction only once that commits: a rollback brings the rows
   * back, and they must still have their files.
   *
   * Each chunk's rows are locked and re-read in the transaction that deletes
   * them, as a single delete does, so the files removed are the ones the rows
   * held at their removal: a crop that committed after the folder's items
   * were listed is seen, and one that reaches its commit while the rows are
   * held finds them gone and removes its own new sizes.
   */
  private async deleteMediaRowsInChunks(
    mediaIds: string[],
    removeFiles: RemoveStoredFiles
  ): Promise<void> {
    if (mediaIds.length === 0) return;
    const chunkSize = 100;
    // In one order, so two deletes holding overlapping chunks cannot each
    // wait on a row the other holds.
    const ordered = [...mediaIds].sort();

    for (let i = 0; i < ordered.length; i += chunkSize) {
      const chunk = ordered.slice(i, i + chunkSize);
      const inChunk = {
        and: [{ column: "id", op: "IN" as const, value: chunk }],
      };
      const removed = await this.adapter.transaction(async tx => {
        // Locked and read in one statement, the chunk's rows at once.
        const current = await tx.select<StoredMediaRecord>("media", {
          where: inChunk,
          forUpdate: true,
        });
        if (current.length > 0) await tx.delete("media", inChunk);
        return current;
      });
      // After the statement, so this only ever names rows that are gone, and
      // inside an enclosing SQLite transaction after that commits. The files
      // another item still refers to are asked for then (filesKeptByOthers).
      await this.afterCommit(() => revalidateMedia(chunk));
      await this.afterCommit(async () =>
        removeFiles(removed, await filesKeptByOthers(this.adapter, removed))
      );
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
      await this.afterCommit(() => revalidateMedia([mediaId]));

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
