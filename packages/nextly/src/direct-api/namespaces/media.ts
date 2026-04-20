/**
 * Direct API Media Namespace
 *
 * Factory for the `nextly.media.*` sub-namespace (including the nested
 * `media.folders` sub-object). Wraps the `MediaService` with pagination and
 * error-conversion behavior.
 *
 * @packageDocumentation
 */

import type {
  MediaFile,
  MediaFolder,
} from "../../services/media/media-service";
import type { PaginatedResponse } from "../../types/pagination";
import { NextlyError, NextlyErrorCode } from "../errors";
import type {
  BulkDeleteMediaArgs,
  BulkOperationResult,
  CreateFolderArgs,
  DeleteMediaArgs,
  DeleteResult,
  FindMediaArgs,
  FindMediaByIDArgs,
  ListFoldersArgs,
  UpdateMediaArgs,
  UploadMediaArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  convertServiceError,
  createRequestContext,
  isNotFoundError,
  mergeConfig,
  toPaginatedResponse,
} from "./helpers";

/**
 * Media MIME type enum accepted by `MediaService.listMedia()`.
 */
type MediaMimeType = "image" | "video" | "audio" | "document" | "other";

/**
 * Nested `media.folders` namespace.
 */
export interface MediaFoldersNamespace {
  list(args?: ListFoldersArgs): Promise<MediaFolder[]>;
  create(args: CreateFolderArgs): Promise<MediaFolder>;
}

/**
 * Media namespace API, bound to a Nextly context.
 */
export interface MediaNamespace {
  upload(args: UploadMediaArgs): Promise<MediaFile>;
  find(args?: FindMediaArgs): Promise<PaginatedResponse<MediaFile>>;
  findByID(args: FindMediaByIDArgs): Promise<MediaFile | null>;
  update(args: UpdateMediaArgs): Promise<MediaFile>;
  delete(args: DeleteMediaArgs): Promise<DeleteResult>;
  bulkDelete(args: BulkDeleteMediaArgs): Promise<BulkOperationResult>;
  folders: MediaFoldersNamespace;
}

/**
 * Build the `media` namespace for a `Nextly` instance.
 */
export function createMediaNamespace(ctx: NextlyContext): MediaNamespace {
  const folders: MediaFoldersNamespace = {
    async list(args: ListFoldersArgs = {}): Promise<MediaFolder[]> {
      try {
        if (args.parent) {
          return await ctx.mediaService.listSubfolders(
            args.parent,
            createRequestContext(args)
          );
        }
        return await ctx.mediaService.listRootFolders(
          createRequestContext(args)
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async create(args: CreateFolderArgs): Promise<MediaFolder> {
      if (!args.name) {
        throw new NextlyError(
          "'name' is required for media.folders.create()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      try {
        return await ctx.mediaService.createFolder(
          {
            name: args.name,
            description: args.description,
            color: args.color,
            icon: args.icon,
            parentId: args.parent ?? null,
          },
          createRequestContext(args)
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },
  };

  return {
    async upload(args: UploadMediaArgs): Promise<MediaFile> {
      try {
        return await ctx.mediaService.upload(
          {
            buffer: args.file.data,
            filename: args.file.name,
            mimeType: args.file.mimetype,
            size: args.file.size,
            altText: args.altText,
            folderId: args.folder ?? null,
          },
          createRequestContext(args)
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async find(
      args: FindMediaArgs = {}
    ): Promise<PaginatedResponse<MediaFile>> {
      const limit = args.limit ?? 24;
      const page = args.page ?? 1;

      try {
        const result = await ctx.mediaService.listMedia(
          {
            page,
            pageSize: limit,
            search: args.search,
            type: args.mimeType as MediaMimeType | undefined,
            folderId: args.folder,
            sortBy: args.sortBy,
            sortOrder: args.sortOrder,
          },
          createRequestContext(args)
        );

        return toPaginatedResponse(result, limit, page);
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async findByID(args: FindMediaByIDArgs): Promise<MediaFile | null> {
      const config = mergeConfig(ctx.defaultConfig, args);

      try {
        return await ctx.mediaService.findById(
          args.id,
          createRequestContext(args)
        );
      } catch (error) {
        if (config.disableErrors && isNotFoundError(error)) {
          return null;
        }
        throw convertServiceError(error);
      }
    },

    async update(args: UpdateMediaArgs): Promise<MediaFile> {
      if (!args.id) {
        throw new NextlyError(
          "'id' is required for media.update()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      try {
        return await ctx.mediaService.update(
          args.id,
          {
            filename: args.data.filename,
            altText: args.data.altText,
            caption: args.data.caption,
            tags: args.data.tags,
            folderId: args.data.folderId,
          },
          createRequestContext(args)
        );
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async delete(args: DeleteMediaArgs): Promise<DeleteResult> {
      if (!args.id) {
        throw new NextlyError(
          "'id' is required for media.delete()",
          NextlyErrorCode.INVALID_INPUT,
          400
        );
      }

      try {
        await ctx.mediaService.delete(args.id, createRequestContext(args));
        return {
          deleted: true,
          ids: [args.id],
        };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    async bulkDelete(args: BulkDeleteMediaArgs): Promise<BulkOperationResult> {
      if (!args.ids || args.ids.length === 0) {
        return {
          success: [],
          failed: [],
          total: 0,
          successCount: 0,
          failedCount: 0,
        };
      }

      try {
        const result = await ctx.mediaService.bulkDelete(
          args.ids,
          createRequestContext(args)
        );

        return {
          success: result.results.filter(r => r.success).map(r => r.id),
          failed: result.results
            .filter(r => !r.success)
            .map(r => ({ id: r.id, error: r.error ?? "Unknown error" })),
          total: result.totalItems,
          successCount: result.successCount,
          failedCount: result.failureCount,
        };
      } catch (error) {
        throw convertServiceError(error);
      }
    },

    folders,
  };
}
