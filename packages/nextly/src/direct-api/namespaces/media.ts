/**
 * Direct API Media Namespace
 *
 * Factory for the `nextly.media.*` sub-namespace (including the nested
 * `media.folders` sub-object). Wraps the `MediaService` with pagination and
 * error-conversion behavior.
 *
 * A write made by an instance, or a call, that asks to be checked
 * (`overrideAccess: false`) is judged as REST's media routes judge the same
 * caller, before any work: `create-media` to upload or make a folder,
 * `update-media` to edit, `delete-media` to delete, and a checked write that
 * names nobody is refused as unauthenticated. A checked read that names nobody
 * is a visitor's, judged by the Public role's `read-media`. A trusted call is
 * unchanged.
 *
 * @packageDocumentation
 */

import {
  currentCallerScope,
  runWithCallerScope,
} from "../../auth/caller-scope";
import { SYSTEM_WRITE_POLICY } from "../../domains/auth/system-write-policy";
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
  checkedCaller,
  checkedScope,
  checkMediaRead,
  checkWrite,
  createRequestContext,
  directApiActor,
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
  // A write is made as the caller the instance and the call name together, so
  // a folder records its creator and a file its uploader whichever of the two
  // named them. The raw call alone dropped an instance-level user.
  const writeContext = (args: Parameters<typeof createRequestContext>[0]) =>
    createRequestContext(mergeConfig(ctx.defaultConfig, args));
  // And recorded as the actor the instance and the call name, so a write made
  // with an API key is recorded as the key, as REST records it, rather than
  // as the key's owner the context names.
  const writeActor = (args: Parameters<typeof createRequestContext>[0]) =>
    directApiActor(ctx.defaultConfig, args);
  // The check and the work run under the key scope the call is checked with,
  // so what the write sets going (an event handler's own service calls) is
  // held to that key, not to a broader one the request around it carries.
  const asChecked = async <T>(
    args: Parameters<typeof createRequestContext>[0],
    work: () => Promise<T>
  ): Promise<T> => {
    const scope = checkedScope(ctx.defaultConfig, args);
    // A checked call that names a person and no key, made inside a request
    // authenticated with a key, is ambiguous: judged as the person, its work
    // would still run under the request's key, and either could be the
    // broader. It is refused rather than resolved either way.
    if (
      scope === undefined &&
      currentCallerScope()?.actorType === "apiKey" &&
      checkedCaller(ctx.defaultConfig, args) !== null
    ) {
      throw new NextlyError({
        code: "FORBIDDEN",
        publicMessage:
          "This request is authenticated with an API key. Pass the key's scope, or call trusted.",
        logContext: { reason: "checked-media-call-names-user-inside-key" },
      });
    }
    return runWithCallerScope(scope, work);
  };

  const folders: MediaFoldersNamespace = {
    async list(args: ListFoldersArgs = {}): Promise<MediaFolder[]> {
      // A read is held to the key scope it is checked with, as a write is.
      return asChecked(args, async () => {
        await checkMediaRead(ctx.defaultConfig, args);
        if (args.parent) {
          return await ctx.mediaService.listSubfolders(
            args.parent,
            createRequestContext(args)
          );
        }
        return await ctx.mediaService.listRootFolders(
          createRequestContext(args)
        );
      });
    },

    async create(args: CreateFolderArgs): Promise<MediaFolder> {
      return asChecked(args, async () => {
        await checkWrite(
          ctx.defaultConfig,
          args,
          SYSTEM_WRITE_POLICY.media.createFolder
        );
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
          writeContext(args)
        );
      });
    },
  };

  return {
    async upload(args: UploadMediaArgs): Promise<MediaFile> {
      return asChecked(args, async () => {
        await checkWrite(
          ctx.defaultConfig,
          args,
          SYSTEM_WRITE_POLICY.media.upload
        );
        return await ctx.mediaService.upload(
          {
            buffer: args.file.data,
            filename: args.file.name,
            mimeType: args.file.mimetype,
            size: args.file.size,
            altText: args.altText,
            folderId: args.folder ?? null,
          },
          writeContext(args),
          writeActor(args)
        );
      });
    },

    async find(args: FindMediaArgs = {}): Promise<ListResult<MediaFile>> {
      return asChecked(args, async () => {
        await checkMediaRead(ctx.defaultConfig, args);
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
      });
    },

    async findByID(args: FindMediaByIDArgs): Promise<MediaFile | null> {
      return asChecked(args, async () => {
        // Refused before the lookup, so `disableErrors` answers a refusal as
        // a refusal, never as a missing file.
        await checkMediaRead(ctx.defaultConfig, args);
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
      });
    },

    async update(args: UpdateMediaArgs): Promise<MutationResult<MediaFile>> {
      return asChecked(args, async () => {
        await checkWrite(
          ctx.defaultConfig,
          args,
          SYSTEM_WRITE_POLICY.media.update
        );
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
          writeContext(args),
          writeActor(args)
        );
        return {
          message: "Media updated.",
          item,
        };
      });
    },

    async delete(
      args: DeleteMediaArgs
    ): Promise<MutationResult<{ id: string }>> {
      return asChecked(args, async () => {
        await checkWrite(
          ctx.defaultConfig,
          args,
          SYSTEM_WRITE_POLICY.media.delete
        );
        if (!args.id) {
          throw new NextlyError({
            code: "INVALID_INPUT",
            publicMessage: "'id' is required for media.delete()",
            statusCode: 400,
          });
        }

        await ctx.mediaService.delete(
          args.id,
          writeContext(args),
          writeActor(args)
        );
        return {
          message: "Media deleted.",
          item: { id: args.id },
        };
      });
    },

    async bulkDelete(args: BulkDeleteMediaArgs): Promise<BulkOperationResult> {
      return asChecked(args, async () => {
        await checkWrite(
          ctx.defaultConfig,
          args,
          SYSTEM_WRITE_POLICY.media.bulkDelete
        );
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
        return ctx.mediaService.bulkDelete(
          args.ids,
          writeContext(args),
          writeActor(args)
        );
      });
    },

    folders,
  };
}
