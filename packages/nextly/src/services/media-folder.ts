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
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { getMediaStorage } from "@nextly/storage";

import {
  lockMediaFolders,
  lockMediaItems,
} from "../domains/media/lock-media-items";
import {
  errorForLog,
  filesKeptByOthers,
  removeStoredFiles,
  storedPathForLog,
  warnUnlocated,
  type StoredFileSearch,
} from "../domains/media/remove-stored-files";
import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../domains/media/revalidate-media";
import { StoredFileSearchReader } from "../domains/media/stored-file-search";
import {
  storedFilesOf,
  type MediaFilesRecord,
} from "../domains/media/stored-files";
import type { ServiceErrorCode } from "../errors/error-codes";
import { consoleLogger } from "../shared/types";
import { mediaPageQuerySchema, type MediaPageQuery } from "../types/media";

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
  /** One page of the folder's own items. */
  mediaFiles: Record<string, unknown>[];
  breadcrumbs: Array<{ id: string; name: string }>;
  /** Which page `mediaFiles` is, and how many items there are in all. */
  meta: FolderContentsPage;
}

/** Which page of a folder's items a response holds. */
export interface FolderContentsPage {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

/**
 * The answer to a folder delete while the folder holds an item deleted
 * inside its Undo window: the folder waits for it.
 */
function pendingDeletesRefusal(): DeleteFolderOutcome {
  return {
    success: false,
    statusCode: 409,
    code: "CONFLICT",
    message:
      "This folder holds items deleted moments ago that can still be brought back. Try again once their Undo has passed.",
  };
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
        consoleLogger.warn(
          "[MediaFolderService] Could not remove the files of the deleted items",
          { error: errorForLog(error) }
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
        consoleLogger.warn(
          `[MediaFolderService] Could not remove ${storedPathForLog(filePath)}: ${errorForLog(new Error(error))}`
        );
      }
    } catch (error) {
      consoleLogger.warn(
        "[MediaFolderService] Could not remove the files of the deleted items",
        { error: errorForLog(error) }
      );
    }
  };
}

export class MediaFolderService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /** How this service reads the media rows that may share a file (filesKeptByOthers). */
  private get storedFileSearch(): StoredFileSearch {
    return new StoredFileSearchReader(this.adapter, this.logger).search;
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
      this.logger.error("[MediaFolderService] Create folder error", {
        error: error,
      });
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
      this.logger.error("[MediaFolderService] Get folder error", {
        error: error,
      });
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
      this.logger.error("[MediaFolderService] List root folders error", {
        error: error,
      });
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
      this.logger.error("[MediaFolderService] List subfolders error", {
        error: error,
      });
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
    folderId: string | null,
    /** Which page of its items, and how they are narrowed and sorted. */
    query: Partial<MediaPageQuery> = {}
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

      // One page of the folder's items, narrowed, sorted and paged in the
      // database by the same condition the media list uses, with the count of
      // every item the narrowing matches.
      const { page, limit, search, type, sortBy, sortOrder } =
        mediaPageQuerySchema.parse(query);
      // Loaded when a folder is read, not with the service.
      const { mediaQueryCondition } = await import(
        "../domains/media/media-library-query"
      );
      const where = mediaQueryCondition(media, null, {
        ...(folderSchemaAvailable ? { folderId: folderId ?? null } : {}),
        search,
        type,
      });
      const [counted] = await this.db
        .select({ value: count() })
        .from(media)
        .where(where);
      const total = Number(counted?.value ?? 0);
      // The id after the sort column, so items uploaded in the same instant
      // keep one order and no item shows on two pages.
      const order = sortOrder === "asc" ? asc : desc;
      const mediaFiles = await this.db
        .select()
        .from(media)
        .where(where)
        .orderBy(order(media[sortBy]), order(media.id))
        .limit(limit)
        .offset((page - 1) * limit);

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
          meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      this.logger.error("[MediaFolderService] Get folder contents error", {
        error: error,
      });
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
      this.logger.error("[MediaFolderService] Update folder error", {
        error: error,
      });
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

    // An item deleted moments ago is hidden from the folder's listing but is
    // still in it until its Undo window ends. Deleting the folder would move
    // it to the library root (the folder going) or delete it before its
    // deadline (the folder's contents going), so the folder waits for it,
    // with or without its contents.
    if (await this.holdsPendingDeletes(folderId)) {
      return pendingDeletesRefusal();
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

  /**
   * `ids` in runs one statement may bind alongside `reserved` values of its
   * own, by the adapter's `maxParamsPerQuery`: SQLite's limit is the lowest,
   * so a large subtree takes a few statements there and one elsewhere.
   */
  private idRuns(ids: readonly string[], reserved: number): string[][] {
    const limit = this.adapter.getCapabilities().maxParamsPerQuery;
    const size = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit) - reserved)
      : 1;
    const runs: string[][] = [];
    for (let start = 0; start < ids.length; start += size) {
      runs.push(ids.slice(start, start + size));
    }
    return runs;
  }

  /**
   * Whether the folder, or any folder under it, holds an item deleted inside
   * its Undo window: the folders asked together, in runs one statement may
   * bind, on the items' folder index, for the first such item.
   */
  private async holdsPendingDeletes(folderId: string): Promise<boolean> {
    const { media } = this.tables;
    // Loaded when a folder is deleted, not with the service.
    const { pendingDelete } = await import(
      "../domains/media/media-library-query"
    );
    const folderIds = [
      folderId,
      ...(await this.collectAllSubfolderIds(folderId)),
    ];
    // The mark's key pattern is the one value the condition binds itself.
    for (const run of this.idRuns(folderIds, 1)) {
      const [found] = await this.db
        .select({ id: media.id })
        .from(media)
        .where(and(inArray(media.folderId, run), pendingDelete(media)))
        .limit(1);
      if (found) return true;
    }
    return false;
  }

  /** The folder and every folder under it, each locked on `tx`. */
  private async subtreeOn(
    tx: TransactionContext,
    folderId: string
  ): Promise<string[]> {
    // Each folder locked before the level under it is read, so a file
    // uploaded or moved into one of them, or a folder created under one,
    // waits for this transaction and then finds its folder gone: nothing
    // lands between what is read here and the delete. A level's folders are
    // found, locked in the one order (`lockMediaFolders`), and read again
    // with a lock, the latest committed on MySQL too, which picks up one
    // created between the two reads.
    await lockMediaFolders(tx, [folderId]);
    const all = [folderId];
    let level = [folderId];
    while (level.length > 0) {
      await lockMediaFolders(tx, await this.childFoldersOn(tx, level, false));
      const next = await this.childFoldersOn(tx, level, true);
      all.push(...next);
      level = next;
    }
    return all;
  }

  /** The folders directly under `parents`, read with a lock when asked. */
  private async childFoldersOn(
    tx: TransactionContext,
    parents: readonly string[],
    forUpdate: boolean
  ): Promise<string[]> {
    const children: string[] = [];
    for (const run of this.idRuns(parents, 0)) {
      const rows = await tx.select<{ id: string }>("media_folders", {
        columns: ["id"],
        where: { and: [{ column: "parentId", op: "IN", value: run }] },
        forUpdate,
      });
      children.push(...rows.map(row => String(row.id)));
    }
    return children;
  }

  /** The ids of the media the folders hold, as `tx` reads them. */
  private async heldMediaOn(
    tx: TransactionContext,
    folderIds: readonly string[]
  ): Promise<string[]> {
    const held: string[] = [];
    for (const run of this.idRuns(folderIds, 0)) {
      const rows = await tx.select<{ id: string }>("media", {
        columns: ["id"],
        where: { and: [{ column: "folderId", op: "IN", value: run }] },
      });
      held.push(...rows.map(row => String(row.id)));
    }
    return [...new Set(held)];
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
      const refusal = await this.refuseUndeletableFolder(
        folderId,
        deleteContents
      );
      if (refusal) return refusal;

      // One transaction, all or nothing. The folder and every folder under
      // it are locked first (`subtreeOn`), so nothing arrives in them while
      // it runs; then every media row they hold is locked, in the order a
      // delete that can be undone locks its items in (`lockMediaItems`), and
      // then their marks are read. An item marked since the check above
      // refuses the whole delete before anything changes: deleting it would
      // cut its Undo short, and moving it would bring it back outside its
      // folder. A mark asked for later waits for these locks and finds its
      // item gone or moved.
      const removal = await this.adapter.transaction(async tx => {
        const folders = await this.subtreeOn(tx, folderId);
        const held = await this.heldMediaOn(tx, folders);
        await lockMediaItems(tx, held);
        if (await this.anyMarked(tx, held)) return null;
        // The rows as they are under their locks, so the files removed are
        // the ones they hold at their removal: a crop committed since the
        // folder was checked is seen, and one reaching its commit while the
        // rows are held finds them gone and removes its own new sizes.
        // Read with a lock, the latest committed on every dialect, and kept
        // only while still in one of the folders: an item moved out before
        // its lock was taken stays.
        const removed: StoredMediaRecord[] = [];
        if (deleteContents) {
          const inSubtree = new Set(folders);
          for (const run of this.idRuns(held, 0)) {
            const rows = (
              await tx.select<StoredMediaRecord & { folderId?: unknown }>(
                "media",
                {
                  where: { and: [{ column: "id", op: "IN", value: run }] },
                  forUpdate: true,
                }
              )
            ).filter(row => inSubtree.has(String(row.folderId)));
            if (rows.length === 0) continue;
            await tx.delete("media", {
              and: [{ column: "id", op: "IN", value: rows.map(row => row.id) }],
            });
            removed.push(...rows);
          }
        }
        await tx.delete("media_folders", {
          and: [{ column: "id", op: "=", value: folderId }],
        });
        // Without its contents, `media.folder_id` is ON DELETE SET NULL:
        // what the folders held has moved to the library root.
        const going = new Set(removed.map(record => record.id));
        return {
          removed,
          moved: held.filter(id => !going.has(id)),
          subfolders: folders.length - 1,
        };
      });
      if (removal === null) return pendingDeletesRefusal();

      // ONE shared-tag flush for the removed items, however many runs their
      // files are removed in.
      if (removal.removed.length > 0) {
        await withMediaRevalidationBatch(() =>
          this.removeFilesOfRemoved(removal.removed, removeFiles)
        );
      }
      // After the statement, so this only names rows the delete really changed,
      // and inside an enclosing SQLite transaction after that commits.
      if (removal.moved.length > 0) {
        await this.afterCommit(() => revalidateMedia(removal.moved));
      }

      const deletedMediaCount = removal.removed.length;
      const deletedFoldersCount = deleteContents ? removal.subfolders : 0;
      return {
        success: true,
        statusCode: 200,
        message: "Folder deleted successfully",
        deletedMedia: deletedMediaCount,
        deletedFolders: deletedFoldersCount,
      };
    } catch (error) {
      this.logger.error("[MediaFolderService] Delete folder error", {
        error: errorForLog(error),
      });
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to delete folder",
      };
    }
  }

  /**
   * Bust the removed items' cache tags and remove their stored files, in
   * runs of a hundred, once their rows are gone: inside an enclosing SQLite
   * transaction only once that commits, since a rollback brings the rows
   * back and they must still have their files. The files another item still
   * refers to are asked for then (`filesKeptByOthers`), and stay.
   */
  private async removeFilesOfRemoved(
    removed: readonly StoredMediaRecord[],
    removeFiles: RemoveStoredFiles
  ): Promise<void> {
    const runSize = 100;
    for (let start = 0; start < removed.length; start += runSize) {
      const run = removed.slice(start, start + runSize);
      const ids = run.map(record => record.id);
      await this.afterCommit(() => revalidateMedia(ids));
      await this.afterCommit(async () => {
        const kept = await filesKeptByOthers(
          this.storedFileSearch,
          run.flatMap(record => storedFilesOf(record).paths),
          ids
        );
        if (kept) await removeFiles(run, kept);
        await this.removeKeptFilesOf(ids);
      });
    }
  }

  /**
   * Whether any of `ids` is marked for a delete inside its Undo window, as
   * the latest committed marks say: read with a lock, so on MySQL it is not
   * answered from a snapshot taken before the rows' locks were waited for.
   */
  private async anyMarked(
    tx: TransactionContext,
    ids: readonly string[]
  ): Promise<boolean> {
    if (ids.length === 0) return false;
    // Loaded when a folder is deleted, not with the service.
    const { pendingDeleteKey } = await import(
      "../domains/media/pending-delete"
    );
    for (const run of this.idRuns(ids, 0)) {
      const [found] = await tx.select("nextly_meta", {
        columns: ["key"],
        where: {
          and: [{ column: "key", op: "IN", value: run.map(pendingDeleteKey) }],
        },
        forUpdate: true,
        limit: 1,
      });
      if (found) return true;
    }
    return false;
  }

  /**
   * The files a Replace kept for the removed items' uses by address, and the
   * record of them: the step a delete of each item runs (`removeKeptFiles`),
   * so a folder's items leave nothing of theirs behind. Never fails the
   * cascade, whose rows are already gone.
   */
  private async removeKeptFilesOf(mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    try {
      // Loaded when a folder's items are deleted, not with the service.
      const { removeKeptFiles } = await import(
        "../domains/media/usage/address-uses"
      );
      await removeKeptFiles(
        this.adapter,
        getMediaStorage(),
        this.logger,
        mediaIds
      );
    } catch (error) {
      this.logger.warn("[MediaFolderService] Kept files not removed", {
        error: errorForLog(error),
      });
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
      // The destination folder, then the item, in the one order
      // (`lockMediaFolders`), so a folder delete holding the folder and
      // waiting for the item takes turns with this move rather than
      // deadlocking with it. A folder gone meanwhile is not found.
      const moved = await this.adapter.transaction(async tx => {
        if (folderId) {
          await lockMediaFolders(tx, [folderId]);
          const [folder] = await tx.select("media_folders", {
            columns: ["id"],
            where: { and: [{ column: "id", op: "=", value: folderId }] },
          });
          if (!folder) return false;
        }
        await lockMediaItems(tx, [mediaId]);
        await tx.update(
          "media",
          { folderId, updatedAt: new Date() },
          { and: [{ column: "id", op: "=", value: mediaId }] }
        );
        return true;
      });
      if (!moved) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Folder not found",
        };
      }

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
      this.logger.error("[MediaFolderService] Move media error", {
        error: error,
      });
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to move media",
      };
    }
  }
}
