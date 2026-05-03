/**
 * Direct API Media Namespace
 *
 * Factory for the `nextly.media.*` sub-namespace (including the nested
 * `media.folders` sub-object). Wraps the `MediaService` with pagination and
 * error-conversion behavior.
 *
 * @packageDocumentation
 */

import { NextlyError } from "../../errors/nextly-error";
import type {
  MediaFile,
  MediaFolder,
} from "../../services/media/media-service";
import type {
  BulkDeleteMediaArgs,
  BulkOperationResult,
  CreateFolderArgs,
  DeleteMediaArgs,
  FindMediaArgs,
  FindMediaByIDArgs,
  ListFoldersArgs,
  ListResult,
  MutationResult,
  UpdateMediaArgs,
  UploadMediaArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  createRequestContext,
  isNotFoundError,
  mergeConfig,
  toListResult,
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
 *
 * Phase 4 (Task 13): list/mutation surfaces use the canonical envelopes.
 * Uploads keep returning the bare `MediaFile` because they're a non-CRUD
 * action and the wire API does not wrap successful uploads in
 * `respondMutation` either.
 */
export interface MediaNamespace {
  upload(args: UploadMediaArgs): Promise<MediaFile>;
  find(args?: FindMediaArgs): Promise<ListResult<MediaFile>>;
  findByID(args: FindMediaByIDArgs): Promise<MediaFile | null>;
  update(args: UpdateMediaArgs): Promise<MutationResult<MediaFile>>;
  delete(args: DeleteMediaArgs): Promise<MutationResult<{ id: string }>>;
  bulkDelete(args: BulkDeleteMediaArgs): Promise<BulkOperationResult>;
  folders: MediaFoldersNamespace;
}

/**
 * Build the `media` namespace for a `Nextly` instance.
 */
export function createMediaNamespace(ctx: NextlyContext): MediaNamespace {
  const folders: MediaFoldersNamespace = {
    async list(args: ListFoldersArgs = {}): Promise<MediaFolder[]> {
      if (args.parent) {
        return await ctx.mediaService.listSubfolders(
          args.parent,
          createRequestContext(args)
        );
      }
      return await ctx.mediaService.listRootFolders(createRequestContext(args));
    },

    async create(args: CreateFolderArgs): Promise<MediaFolder> {
      if (!args.name) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'name' is required for media.folders.create()",
          statusCode: 400,
        });
      }

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
    },
  };

  return {
    async upload(args: UploadMediaArgs): Promise<MediaFile> {
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
    },

    async find(args: FindMediaArgs = {}): Promise<ListResult<MediaFile>> {
      const limit = args.limit ?? 24;
      const page = args.page ?? 1;

      const result = await ctx.mediaService.listMedia(
        {
          page,
          limit,
          search: args.search,
          type: args.mimeType as MediaMimeType | undefined,
          folderId: args.folder,
          sortBy: args.sortBy,
          sortOrder: args.sortOrder,
        },
        createRequestContext(args)
      );

      return toListResult(result, limit, page);
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
        throw error;
      }
    },

    async update(args: UpdateMediaArgs): Promise<MutationResult<MediaFile>> {
      if (!args.id) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'id' is required for media.update()",
          statusCode: 400,
        });
      }

      const item = await ctx.mediaService.update(
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
      // Phase 4 (Task 13): mutations return `{ message, item }`.
      return {
        message: "Media updated.",
        item,
      };
    },

    async delete(
      args: DeleteMediaArgs
    ): Promise<MutationResult<{ id: string }>> {
      if (!args.id) {
        throw new NextlyError({
          code: "INVALID_INPUT",
          publicMessage: "'id' is required for media.delete()",
          statusCode: 400,
        });
      }

      await ctx.mediaService.delete(args.id, createRequestContext(args));
      return {
        message: "Media deleted.",
        item: { id: args.id },
      };
    },

    async bulkDelete(args: BulkDeleteMediaArgs): Promise<BulkOperationResult> {
      if (!args.ids || args.ids.length === 0) {
        return {
          successes: [],
          failures: [],
          total: 0,
          successCount: 0,
          failedCount: 0,
        };
      }

      // Phase 4.5: mediaService.bulkDelete now returns the canonical
      // BulkOperationResult shape (successes + failures) directly. No
      // translation needed at the direct-api boundary anymore.
      return ctx.mediaService.bulkDelete(args.ids, createRequestContext(args));
    },

    folders,
  };
}
