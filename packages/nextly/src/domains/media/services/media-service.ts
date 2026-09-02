/**
 * MediaService - Unified service for media file and folder operations
 *
 * This service provides a clean API for both media file operations (upload, delete, etc.)
 * and folder management (create, organize, move files). It follows the new service layer
 * architecture with:
 *
 * - Exception-based error handling using NextlyError
 * - RequestContext for user/locale context
 * - PaginatedResult for list operations
 * - Constructor injection for storage and image processor
 *
 * Internally delegates to the legacy MediaService and MediaFolderService for the actual
 * implementation, converting their result-shape return format to throw-based NextlyError.
 *
 * @example
 * ```typescript
 * import { MediaService, NextlyError } from 'nextly';
 *
 * const service = new MediaService(legacyMediaService, legacyFolderService, storage, imageProcessor);
 *
 * // Upload a file
 * const file = await service.upload({
 *   buffer: fileBuffer,
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 *   size: 1024000,
 * }, context);
 *
 * // Create a folder
 * const folder = await service.createFolder({ name: 'Photos' }, context);
 *
 * // Move file to folder
 * await service.moveToFolder(file.id, folder.id, context);
 *
 * // Error handling
 * try {
 *   const media = await service.findById('nonexistent', context);
 * } catch (error) {
 *   if (NextlyError.isNotFound(error)) {
 *     console.log(error.code); // 'NOT_FOUND'
 *     console.log(error.statusCode); // 404
 *   }
 * }
 * ```
 */

// PR 4 migration: replaced ServiceError throws + mapLegacy/mapSimple helpers
// with NextlyError factories. Identifiers (mediaId/folderId/etc) move to
// logContext per §13.8; public messages remain generic and end with a period.
import { actorForWrite, type RequestActor } from "../../../auth/request-actor";
import type { RetentionRunner } from "../../../domains/retention/runner";
import type { WebhookFastDrainScheduler } from "../../../domains/webhooks/after-drain";
import { isUnscopedRecordingActive } from "../../../domains/webhooks/recording-activation";
import { NextlyError } from "../../../errors";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import { emitMediaEvent } from "../../../events/domain-events";
import { normalizeDbTimestamp } from "../../../lib/date-formatting";
import { toAbsoluteMediaUrl } from "../../../lib/media-variant";
import type { MediaService as LegacyMediaService } from "../../../services/media";
import type {
  MediaFolderService as LegacyFolderService,
  MediaFolder as LegacyMediaFolder,
  CreateFolderInput as LegacyCreateFolderInput,
  UpdateFolderInput as LegacyUpdateFolderInput,
} from "../../../services/media-folder";
import { stripHtmlTags } from "../../../services/security/sanitization-service";
import type {
  RequestContext,
  PaginatedResult,
  Logger,
} from "../../../services/shared";
import { consoleLogger } from "../../../services/shared";
import type { UploadValidator } from "../../../services/upload-validation";
import type {
  ImageProcessor,
  ImageValidity,
} from "../../../storage/image-processor";
import type { IStorageAdapter } from "../../../storage/types";
import {
  isImageMimeType,
  validateFileSize,
  type MediaParams,
  type Media as LegacyMedia,
} from "../../../types/media";
import { withMediaRevalidationBatch } from "../revalidate-media";
import type {
  MediaFile,
  UploadMediaInput,
  UpdateMediaInput,
  ListMediaOptions,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContents,
  BulkOperationResult,
  BulkUploadOperationResult,
} from "../types";

export type {
  MediaFile,
  MediaType,
  UploadMediaInput,
  UpdateMediaInput,
  ListMediaOptions,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderContents,
  BulkOperationResult,
  BulkUploadOperationResult,
} from "../types";

/**
 * Extended row type for media data from legacy services or raw DB queries.
 * Includes both camelCase (service) and snake_case (raw DB) field variants.
 */
interface MediaRow extends LegacyMedia {
  folderId?: string | null;
  uploaded_at?: Date | string;
  updated_at?: Date | string;
}

/**
 * Extended row type for folder data from legacy services or raw DB queries.
 */
interface MediaFolderRow extends LegacyMediaFolder {
  created_at?: Date | string;
  updated_at?: Date | string;
}

// ============================================================
// Sanitization Helpers
// ============================================================

/**
 * Sanitize media metadata fields by stripping HTML tags.
 * Processes altText, caption, and each element of tags[].
 * Mutates the input object in place for efficiency.
 */
function sanitizeMediaInput(input: {
  altText?: string | null;
  caption?: string | null;
  tags?: string[];
}): void {
  if (typeof input.altText === "string") {
    input.altText = stripHtmlTags(input.altText);
  }
  if (typeof input.caption === "string") {
    input.caption = stripHtmlTags(input.caption);
  }
  if (Array.isArray(input.tags)) {
    input.tags = input.tags.map(tag =>
      typeof tag === "string" ? stripHtmlTags(tag) : tag
    );
  }
}

export function toMediaDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  const normalized = normalizeDbTimestamp(value);
  return new Date(normalized || new Date());
}

/**
 * Whether a failed folder result is the service refusing well-formed input.
 *
 * A folder that cannot be moved into itself, or deleted while it still holds
 * something, is not a malformed request: the boundary answers it with a
 * field-anchored validation error a caller can act on, rather than the generic
 * sentence a bare code carries.
 *
 * Reads the code the service names, and still recognises a bare 400 for a
 * producer that names none — those were the only failures reaching this branch
 * before any of them named a code, and the branch has to keep answering them
 * the same way.
 */
function isRefusedInput(result: {
  code?: string;
  statusCode: number;
}): boolean {
  if (result.code) return result.code === "INVALID_INPUT";
  return result.statusCode === 400;
}

// ============================================================
// MediaService
// ============================================================

/**
 * MediaService - Unified service for media files and folders
 *
 * Provides complete media management with:
 *
 * - Exception-based error handling (throws NextlyError)
 * - Type-safe RequestContext
 * - PaginatedResult for list operations
 * - Storage provider injection for testability
 * - Logging support
 */
export class MediaService {
  constructor(
    private readonly legacyMediaService: LegacyMediaService,
    private readonly legacyFolderService: LegacyFolderService,
    private readonly storageOrGetter:
      | IStorageAdapter
      | (() => IStorageAdapter | null)
      | null,
    private readonly imageProcessor: ImageProcessor,
    private readonly uploadValidator: UploadValidator,
    /**
     * Whether sanitized SVGs are persisted with `Content-Disposition: attachment`.
     * Mirrors `UploadService`'s `svgCsp` flag — sourced from
     * `config.security.uploads.svgCsp` (default `true`).
     */
    private readonly svgCsp: boolean = true,
    private readonly logger: Logger = consoleLogger,
    /**
     * Retention passes offered after a write. The shared runner carries both —
     * the webhook outbox and the audit trails — each on its own window and its
     * own gate, and decides which are configured.
     *
     * Absent only when NEITHER has anything to prune: an install with webhook
     * retention off and audit retention on still gets one. A construction site
     * that forwards a single policy leaves that domain unpruned rather than
     * failing, so both belong wherever this is built.
     */
    private readonly retentionRunner?: RetentionRunner,
    /**
     * Shared post-response drain fast path. A media write commits its outbox
     * row inside the DB transaction; `offer()` then schedules the immediate
     * drain so subscribers are notified without waiting for the periodic
     * scheduled drain. Absent only when webhooks were never registered.
     */
    private readonly fastDrainScheduler?: WebhookFastDrainScheduler
  ) {}

  // A short prune pass on the write path: enough to keep the outbox from
  // growing unbounded without turning a media write into a long maintenance
  // job. Mirrors the collection write path.
  private static readonly WRITE_PATH_PRUNE_BATCHES = 2;

  /**
   * The post-write side effects, run after a media write that appended an
   * outbox event. The drain fast path goes first so the post-response
   * `after()` callback is scheduled promptly (it adds no latency); the
   * retention pass follows. Both absorb their own failures (`maybeRun` never
   * throws, `offer` only registers the callback), so this never turns a
   * committed media write into an error. Mirrors the collection write path.
   */
  private async afterWrite(): Promise<void> {
    // Only offer the fast drain when a media write would have recorded an event
    // (an endpoint exists, or audit is on). Media has no per-entity opt-out, so
    // this sync check equals the recorder's result; without it an install with
    // no webhooks pays a fresh `nextly_webhooks` query on every media write.
    // Retention still runs — it prunes prior rows regardless.
    if (isUnscopedRecordingActive()) this.fastDrainScheduler?.offer();
    await this.retentionRunner?.maybeRun(MediaService.WRITE_PATH_PRUNE_BATCHES);
  }

  /**
   * Get the storage adapter (supports both direct reference and getter function)
   * This allows for late-registration of storage plugins
   */
  private getStorage(): IStorageAdapter | null {
    if (typeof this.storageOrGetter === "function") {
      return this.storageOrGetter();
    }
    return this.storageOrGetter;
  }

  /**
   * Ensure storage is configured before media operations
   * @throws NextlyError(VALIDATION_ERROR) if storage is not configured.
   */
  private ensureStorageConfigured(): IStorageAdapter {
    const storage = this.getStorage();
    if (!storage) {
      // Per §13.8 the per-error message names the field but never the value.
      // Operator hint stays in logContext.
      throw NextlyError.validation({
        errors: [
          {
            path: "storage",
            code: "MISSING",
            message: "Storage is not configured.",
          },
        ],
        logContext: {
          reason: "missing-storage-plugin",
          hint: "Add storage: getStorageFromEnv() to your nextly.config.ts",
        },
      });
    }
    return storage;
  }

  // ============================================================
  // Media File Operations
  // ============================================================

  /**
   * Upload a media file
   *
   * @param input - Upload data (buffer, filename, mimeType, size)
   * @param context - Request context with user info
   * @returns Uploaded media file
   * @throws NextlyError if upload fails (e.g., invalid file, size limit).
   *
   * @example
   * ```typescript
   * const file = await service.upload({
   *   buffer: fileBuffer,
   *   filename: 'photo.jpg',
   *   mimeType: 'image/jpeg',
   *   size: 1024000,
   * }, context);
   * ```
   */
  async upload(
    input: UploadMediaInput,
    context: RequestContext,
    // The transport-resolved caller, threaded to the outbox event so an upload
    // attributes to the real session or API key rather than only the uploader.
    actor?: RequestActor
  ): Promise<MediaFile> {
    // Ensure storage is configured before upload
    this.ensureStorageConfigured();

    this.logger.debug("Uploading media file", {
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      userId: context.user?.id,
    });

    // Validate file size. Field-level message names the path ("size") but
    // never the value; the actual byte count + driver-supplied reason live
    // in logContext for operators.
    // The cap comes from the validator's resolved config, not from this
    // helper's default: a constant here refused files the configured policy
    // permits, and the refusal named a limit the install never set.
    const sizeValidation = validateFileSize(
      input.size,
      this.uploadValidator.config().maxSize
    );
    if (!sizeValidation.valid) {
      throw NextlyError.validation({
        errors: [
          {
            path: "size",
            code: "INVALID",
            message: "File size is invalid.",
          },
        ],
        logContext: {
          actualSize: input.size,
          reason: sizeValidation.error || "Invalid file size",
        },
      });
    }

    // Sanitize metadata fields before storage (defense-in-depth)
    sanitizeMediaInput(input);

    const validation = await this.uploadValidator.validate({
      buffer: input.buffer,
      filename: input.filename,
      mimeType: input.mimeType,
    });
    if (!validation.ok) {
      this.logger.warn("upload.rejected", {
        event: "nextly.upload.rejected",
        code: validation.errors[0]?.code,
        route: "media-service.upload",
        mimeType: input.mimeType,
        filename: input.filename,
        size: input.size,
      });
      throw NextlyError.validation({
        errors: validation.errors,
        logContext: {
          ...validation.logContext,
          operation: "media-service.upload",
          userId: context.user?.id ?? null,
        },
      });
    }
    const validated = validation.value;

    // Validate the target folder BEFORE persisting the file so a bad folderId
    // fails fast (throws NOT_FOUND) instead of leaving an orphaned upload, and
    // so the folder can be written on the initial insert below rather than via a
    // separate post-upload move.
    if (input.folderId) {
      await this.findFolderById(input.folderId, context);
    }

    const result = await this.legacyMediaService.uploadMedia(
      {
        file: validated.buffer,
        filename: validated.filename,
        mimeType: validated.mimeType,
        // Use validated buffer length so the DB row matches what's actually
        // in storage (SVG sanitization can shrink the byte count).
        size: validated.buffer.length,
        // Nullable: CLI seeds and system imports run without a user.
        uploadedBy: context.user?.id ?? null,
        // Persist the target folder on the initial insert so the committed row
        // and its `media.uploaded` event reflect the final folder atomically,
        // rather than recording folderId:null and moving the row afterward
        // (which left subscribers seeing the wrong folder and no move event).
        // The legacy insert normalizes a missing folder to null itself.
        folderId: input.folderId ?? undefined,
        contentDisposition:
          validated.isSvg && this.svgCsp ? "attachment" : undefined,
      },
      actor
    );

    if (!result.success || !result.data) {
      this.logger.warn("Media upload failed", {
        filename: input.filename,
        message: result.message,
        statusCode: result.statusCode,
      });
      throw this.mapLegacyErrorToNextlyError(result);
    }

    this.logger.info("Media file uploaded", {
      mediaId: result.data.id,
      filename: result.data.filename,
    });

    emitMediaEvent("uploaded", {
      mediaId: result.data.id,
      filename: result.data.filename,
    });

    // The upload committed a media.uploaded outbox row; drain and prune it.
    await this.afterWrite();

    return this.mapToMediaFile(result.data);
  }

  /**
   * Find a media file by ID
   *
   * @param mediaId - Media file ID
   * @param context - Request context
   * @returns Media file data
   * @throws NextlyError(NOT_FOUND) if the file doesn't exist.
   */
  async findById(
    mediaId: string,
    _context: RequestContext
  ): Promise<MediaFile> {
    this.logger.debug("Finding media by ID", { mediaId });

    const result = await this.legacyMediaService.getMediaById(mediaId);

    if (!result.success || !result.data) {
      // Through the converter, so a lookup that failed for a reason OTHER than
      // absence says so. Answering every failure as "not found" told a caller a
      // record does not exist when the database was unreachable or the request
      // was rate limited, and no retry follows from that.
      //
      // A code-less failure still resolves to NOT_FOUND, since 404 is what a
      // missing row reports and that is the overwhelming case; the id stays
      // operator-side either way (spec 13.8).
      throw this.mapLegacyErrorToNextlyError(
        { ...result, statusCode: result.statusCode ?? 404, data: null },
        { entity: "media", mediaId }
      );
    }

    return this.mapToMediaFile(result.data);
  }

  /**
   * List media files with pagination and filtering
   *
   * @param options - Query options (pagination, search, filters)
   * @param context - Request context
   * @returns Paginated list of media files
   */
  async listMedia(
    options: ListMediaOptions = {},
    _context: RequestContext
  ): Promise<PaginatedResult<MediaFile>> {
    this.logger.debug("Listing media files", { options });

    const page = options.page ?? 1;
    const limit = options.limit ?? 24;

    const queryParams: MediaParams = {
      page,
      limit,
      search: options.search,
      type: options.type,
      folderId: options.folderId,
      sortBy: options.sortBy ?? "uploadedAt",
      sortOrder: options.sortOrder ?? "desc",
    };

    const result = await this.legacyMediaService.listMedia(queryParams);

    if (!result.success) {
      throw this.mapLegacyErrorToNextlyError(result);
    }

    const files = (result.data ?? []).map(m => this.mapToMediaFile(m));
    const total = result.meta?.total ?? files.length;
    const offset = (page - 1) * limit;

    return {
      data: files,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + files.length < total,
      },
    };
  }

  /**
   * Update media file metadata
   *
   * @param mediaId - Media file ID
   * @param input - Update data
   * @param context - Request context
   * @returns Updated media file
   * @throws NextlyError if update fails.
   */
  async update(
    mediaId: string,
    input: UpdateMediaInput,
    context: RequestContext,
    // The transport-resolved caller, threaded to the outbox event.
    actor?: RequestActor
  ): Promise<MediaFile> {
    this.logger.debug("Updating media file", { mediaId, input });

    // Sanitize metadata fields before storage (defense-in-depth)
    sanitizeMediaInput(input);

    // Attribute the write to the transport actor when present, otherwise to the
    // request-context user. A Direct-API call (nextly.media.update({ user }))
    // carries the user but no transport actor, so without this fallback its
    // event would record as `system`. Plain-HTTP callers already pass a
    // resolved `actor`, so this leaves them unchanged.
    const resolvedActor = actorForWrite(actor, context.user);

    // A metadata update may also move the item (folderId in the patch). Validate
    // the target folder up front (throws NOT_FOUND) and forward it, so the move
    // actually happens and is captured in the media.updated event rather than
    // silently dropped. `null` moves to root and needs no validation.
    if (input.folderId) {
      await this.findFolderById(input.folderId, context);
    }

    const result = await this.legacyMediaService.updateMedia(
      mediaId,
      {
        altText: input.altText ?? undefined,
        caption: input.caption ?? undefined,
        tags: input.tags,
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      },
      resolvedActor
    );

    if (!result.success || !result.data) {
      // One throw. The converter answers a code-less 404 with the same generic
      // "Not found.", so the status branch that stood here only decided whether
      // the caller's context reached the log -- and a result naming its own code
      // skipped it, taking the id with it. Identifiers are operator-only.
      throw this.mapLegacyErrorToNextlyError(result, {
        entity: "media",
        mediaId,
      });
    }

    this.logger.info("Media file updated", { mediaId });

    // The update committed a media.updated outbox row; drain and prune it.
    await this.afterWrite();

    return this.mapToMediaFile(result.data);
  }

  /**
   * Delete a media file
   *
   * @param mediaId - Media file ID
   * @param context - Request context
   * @throws NextlyError if deletion fails.
   */
  async delete(
    mediaId: string,
    context: RequestContext,
    // The transport-resolved caller, threaded to the outbox event.
    actor?: RequestActor
  ): Promise<void> {
    this.logger.debug("Deleting media file", { mediaId });

    // Attribute the write to the transport actor when present, otherwise to the
    // request-context user, so a Direct-API delete (which carries the user but
    // no transport actor) is not recorded as `system`. Plain-HTTP callers pass
    // a resolved `actor` and are unaffected.
    const resolvedActor = actorForWrite(actor, context.user);

    const result = await this.legacyMediaService.deleteMedia(
      mediaId,
      resolvedActor
    );

    if (!result.success) {
      throw this.mapSimpleErrorToNextlyError(result, {
        entity: "media",
        mediaId,
      });
    }

    this.logger.info("Media file deleted", { mediaId });

    emitMediaEvent("deleted", { mediaId });

    // The delete committed a media.deleted outbox row; drain and prune it.
    await this.afterWrite();
  }

  /**
   * Upload multiple files.
   *
   * Phase 4.5: returns BulkUploadOperationResult<MediaFile>. Successes
   * carry the newly-created MediaFile records (with assigned ids); failures
   * are positional (no id, since the upload never made it that far) and
   * carry canonical NextlyErrorCode + public-safe message.
   *
   * @param inputs - Array of files to upload
   * @param context - Request context
   * @returns Bulk-upload operation result with full MediaFile on success
   */
  async bulkUpload(
    inputs: UploadMediaInput[],
    context: RequestContext,
    // Forwarded to each per-item upload so every fan-out event attributes to
    // the same transport-resolved caller.
    actor?: RequestActor
  ): Promise<BulkUploadOperationResult<MediaFile>> {
    this.logger.debug("Bulk uploading media files", { count: inputs.length });

    // ONE cache flush for the whole fan-out. Every file below reaches the
    // single-item method, which invalidates against its own commit, and each of
    // their tag sets carries the same `nextly:media` — so without a scope here
    // N files re-invalidate that one collection tag N times.
    return withMediaRevalidationBatch(
      () => this.fanOutUploads(inputs, context, actor),
      this.logger
    );
  }

  /**
   * The per-file upload fan-out, split out so the method above owns nothing but
   * the batch scope its invalidation needs.
   */
  private async fanOutUploads(
    inputs: UploadMediaInput[],
    context: RequestContext,
    actor?: RequestActor
  ): Promise<BulkUploadOperationResult<MediaFile>> {
    // Phase 4.5: per-file uploads run concurrently via Promise.allSettled
    // so the wall time matches today's client-side fan-out pattern. Each
    // closure resolves to a discriminated outcome (success|failure); we
    // partition into successes/failures arrays after all settle. The
    // db connection pool and storage adapter throttle real concurrency.
    type UploadOutcome =
      | { kind: "success"; file: MediaFile }
      | {
          kind: "failure";
          index: number;
          filename: string;
          code: string;
          message: string;
        };

    const outcomes = await Promise.allSettled(
      inputs.map(async (input, i): Promise<UploadOutcome> => {
        try {
          const file = await this.upload(input, context, actor);
          return { kind: "success", file };
        } catch (error) {
          // NextlyError thrown from below the boundary preserves canonical
          // code + publicMessage. Anything else maps to INTERNAL_ERROR; the
          // operator log carries full detail (no public leak per spec §13.8).
          if (NextlyError.is(error)) {
            return {
              kind: "failure",
              index: i,
              filename: input.filename,
              code: String(error.code),
              message: error.publicMessage,
            };
          }
          this.logger.warn("Bulk upload item failed (non-NextlyError)", {
            filename: input.filename,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            kind: "failure",
            index: i,
            filename: input.filename,
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
          };
        }
      })
    );

    const successes: MediaFile[] = [];
    const failures: BulkUploadOperationResult<MediaFile>["failures"] = [];

    outcomes.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        const value = outcome.value;
        if (value.kind === "success") {
          successes.push(value.file);
        } else {
          failures.push({
            index: value.index,
            filename: value.filename,
            code: value.code,
            message: value.message,
          });
        }
      } else {
        // Defensive: per-item closure rejected unexpectedly (the closure
        // already has a catch, so this should not happen). Surface as
        // INTERNAL_ERROR rather than swallowing.
        const filename = inputs[i]?.filename ?? `file-${i}`;
        failures.push({
          index: i,
          filename,
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        });
      }
    });

    return {
      successes,
      failures,
      total: inputs.length,
      successCount: successes.length,
      failedCount: failures.length,
    };
  }

  /**
   * Delete multiple media files.
   *
   * Phase 4.5: returns BulkOperationResult<{id}>. Successes carry the
   * deleted ids; failures are id-keyed with canonical NextlyErrorCode.
   *
   * @param mediaIds - Array of media IDs to delete
   * @param context - Request context
   * @returns Bulk operation result with id-only successes
   */
  async bulkDelete(
    mediaIds: string[],
    context: RequestContext,
    // Forwarded to each per-item delete so every fan-out event attributes to
    // the same transport-resolved caller.
    actor?: RequestActor
  ): Promise<BulkOperationResult<{ id: string }>> {
    this.logger.debug("Bulk deleting media files", { count: mediaIds.length });

    // ONE cache flush for the whole fan-out — see `bulkUpload`. The scope is
    // flushed even when the fan-out throws, so ids that did commit are still
    // busted rather than left serving a deleted file from cache.
    return withMediaRevalidationBatch(
      () => this.fanOutDeletes(mediaIds, context, actor),
      this.logger
    );
  }

  /**
   * The per-id delete fan-out, split out so the method above owns nothing but
   * the batch scope its invalidation needs.
   */
  private async fanOutDeletes(
    mediaIds: string[],
    context: RequestContext,
    actor?: RequestActor
  ): Promise<BulkOperationResult<{ id: string }>> {
    // Phase 4.5: per-id deletions run concurrently via Promise.allSettled.
    // Same rationale as bulkUpload: HTTP single round-trip plus parallel
    // server-side processing matches today's wall-time. Per-row hooks
    // and access control still fire (each closure calls the single-item
    // delete method which preserves the full pipeline).
    type DeleteOutcome =
      | { kind: "success"; id: string }
      | { kind: "failure"; id: string; code: string; message: string };

    const outcomes = await Promise.allSettled(
      mediaIds.map(async (mediaId): Promise<DeleteOutcome> => {
        try {
          await this.delete(mediaId, context, actor);
          return { kind: "success", id: mediaId };
        } catch (error) {
          if (NextlyError.is(error)) {
            return {
              kind: "failure",
              id: mediaId,
              code: String(error.code),
              message: error.publicMessage,
            };
          }
          this.logger.warn("Bulk delete item failed (non-NextlyError)", {
            mediaId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            kind: "failure",
            id: mediaId,
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
          };
        }
      })
    );

    const successes: Array<{ id: string }> = [];
    const failures: BulkOperationResult<{ id: string }>["failures"] = [];

    outcomes.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        const value = outcome.value;
        if (value.kind === "success") {
          successes.push({ id: value.id });
        } else {
          failures.push({
            id: value.id,
            code: value.code,
            message: value.message,
          });
        }
      } else {
        // Defensive: per-item closure rejected unexpectedly. Surface as
        // INTERNAL_ERROR rather than swallowing.
        failures.push({
          id: mediaIds[i] ?? "",
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        });
      }
    });

    return {
      successes,
      failures,
      total: mediaIds.length,
      successCount: successes.length,
      failedCount: failures.length,
    };
  }

  /**
   * Move a media file to a folder
   *
   * @param mediaId - Media file ID
   * @param folderId - Target folder ID (null for root)
   * @param context - Request context
   * @throws NextlyError if move fails.
   */
  async moveToFolder(
    mediaId: string,
    folderId: string | null,
    context: RequestContext,
    // The transport-resolved caller, threaded to the outbox event.
    actor?: RequestActor
  ): Promise<void> {
    this.logger.debug("Moving media to folder", { mediaId, folderId });

    // Validate the target folder up front (throws NOT_FOUND) so a bad folder
    // fails before the write, preserving the prior move path's 404 behavior.
    if (folderId) {
      await this.findFolderById(folderId, context);
    }

    // Route the move through the update path so the folder change is captured
    // as a media.updated outbox event — a bare folder write recorded nothing,
    // leaving subscribers unaware of moves. Attribute it to the transport actor
    // when present, otherwise the request-context user.
    const resolvedActor = actorForWrite(actor, context.user);
    const result = await this.legacyMediaService.updateMedia(
      mediaId,
      { folderId },
      resolvedActor
    );

    if (!result.success) {
      // One throw. The converter answers a code-less 404 with the same generic
      // "Not found.", so the branch that stood here only decided whether the
      // caller's context reached the log. Identifiers are operator-only.
      throw this.mapLegacyErrorToNextlyError(result, {
        entity: "media",
        mediaId,
        folderId,
      });
    }

    this.logger.info("Media moved to folder", { mediaId, folderId });

    // The update committed a media.updated outbox row; drain and prune it.
    await this.afterWrite();
  }

  /**
   * Get storage type
   *
   * @returns Storage type string ('local', 'vercel-blob', 's3', 'r2'), or 'none' if not configured
   */
  getStorageType(): string {
    return this.getStorage()?.getType() ?? "none";
  }

  /**
   * Check if storage is configured
   */
  hasStorage(): boolean {
    return this.getStorage() !== null;
  }

  // ============================================================
  // Folder Operations
  // ============================================================

  /**
   * Create a new folder
   *
   * @param input - Folder data
   * @param context - Request context
   * @returns Created folder
   * @throws NextlyError if creation fails.
   */
  async createFolder(
    input: CreateFolderInput,
    context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Creating folder", {
      name: input.name,
      parentId: input.parentId,
    });

    const legacyInput: LegacyCreateFolderInput = {
      name: input.name,
      description: input.description,
      parentId: input.parentId ?? undefined,
      createdBy: context.user?.id ?? "anonymous",
    };

    const result = await this.legacyFolderService.createFolder(legacyInput);

    if (!result.success || !result.data) {
      // One throw, whatever the failure was. The status branches that used to
      // stand here answered exactly what the shared converter answers, so all
      // they decided was whether the caller's context reached the log — and a
      // folder service that names its own code skipped them, taking the name
      // and parent with it.
      //
      // Identifiers go to the operator only; the public message never carries
      // them (spec 13.8).
      throw this.mapSimpleErrorToNextlyError(result, {
        entity: "folder",
        name: input.name,
        parentId: input.parentId,
      });
    }

    this.logger.info("Folder created", { folderId: result.data.id });

    return this.mapToMediaFolder(result.data);
  }

  /**
   * Find a folder by ID
   *
   * @param folderId - Folder ID
   * @param context - Request context
   * @returns Folder data
   * @throws NextlyError(NOT_FOUND) if the folder doesn't exist.
   */
  async findFolderById(
    folderId: string,
    _context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Finding folder by ID", { folderId });

    const result = await this.legacyFolderService.getFolderById(folderId);

    if (!result.success || !result.data) {
      // Same as findById: a failure that named its own reason keeps it, rather
      // than every lookup failure being reported as absence.
      throw this.mapSimpleErrorToNextlyError(
        { ...result, statusCode: result.statusCode ?? 404 },
        { entity: "folder", folderId }
      );
    }

    return this.mapToMediaFolder(result.data);
  }

  /**
   * List root folders
   *
   * @param context - Request context
   * @returns List of root folders
   */
  async listRootFolders(_context: RequestContext): Promise<MediaFolder[]> {
    this.logger.debug("Listing root folders");

    const result = await this.legacyFolderService.listRootFolders();

    if (!result.success) {
      // No id to name: this lists the root, so the entity is all the context
      // there is.
      throw this.mapSimpleErrorToNextlyError(result, { entity: "folder" });
    }

    return (result.data ?? []).map(f => this.mapToMediaFolder(f));
  }

  /**
   * List subfolders of a folder
   *
   * @param parentId - Parent folder ID
   * @param context - Request context
   * @returns List of subfolders
   */
  async listSubfolders(
    parentId: string,
    _context: RequestContext
  ): Promise<MediaFolder[]> {
    this.logger.debug("Listing subfolders", { parentId });

    const result = await this.legacyFolderService.listSubfolders(parentId);

    if (!result.success) {
      throw this.mapSimpleErrorToNextlyError(result, {
        entity: "folder",
        parentId,
      });
    }

    return (result.data ?? []).map(f => this.mapToMediaFolder(f));
  }

  /**
   * Get folder contents (subfolders + files)
   *
   * @param folderId - Folder ID (null for root)
   * @param context - Request context
   * @returns Folder contents with breadcrumbs
   */
  async getFolderContents(
    folderId: string | null,
    _context: RequestContext
  ): Promise<FolderContents> {
    this.logger.debug("Getting folder contents", { folderId });

    const result = await this.legacyFolderService.getFolderContents(folderId);

    if (!result.success || !result.data) {
      // One throw. The converter answers a code-less 404 with the same generic
      // "Not found.", so the branch that stood here only decided whether the
      // caller's context reached the log. Identifiers are operator-only.
      throw this.mapSimpleErrorToNextlyError(result, {
        entity: "folder",
        folderId,
      });
    }

    return {
      folder: this.mapToMediaFolder(result.data.folder),
      subfolders: result.data.subfolders.map(f => this.mapToMediaFolder(f)),
      files: (result.data.mediaFiles as unknown as MediaRow[]).map(m =>
        this.mapToMediaFile(m)
      ),
      breadcrumbs: result.data.breadcrumbs,
    };
  }

  /**
   * Update a folder
   *
   * @param folderId - Folder ID
   * @param input - Update data
   * @param context - Request context
   * @returns Updated folder
   * @throws NextlyError if update fails.
   */
  async updateFolder(
    folderId: string,
    input: UpdateFolderInput,
    _context: RequestContext
  ): Promise<MediaFolder> {
    this.logger.debug("Updating folder", { folderId, input });

    const legacyInput: LegacyUpdateFolderInput = {
      name: input.name,
      description: input.description,
      parentId: input.parentId ?? undefined,
    };

    const result = await this.legacyFolderService.updateFolder(
      folderId,
      legacyInput
    );

    if (!result.success || !result.data) {
      if (isRefusedInput(result)) {
        // Per §13.8 the per-error message names the field but never the value;
        // driver text moves to logContext.
        throw NextlyError.validation({
          errors: [
            {
              path: "folder",
              code: "INVALID",
              message: "Folder update is invalid.",
            },
          ],
          logContext: { folderId, legacyMessage: result.message },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result, {
        entity: "folder",
        folderId,
      });
    }

    this.logger.info("Folder updated", { folderId });

    return this.mapToMediaFolder(result.data);
  }

  /**
   * Delete a folder
   *
   * @param folderId - Folder ID
   * @param deleteContents - Whether to delete contents (default: false)
   * @param context - Request context
   * @throws NextlyError if deletion fails.
   */
  async deleteFolder(
    folderId: string,
    deleteContents: boolean = false,
    _context: RequestContext
  ): Promise<void> {
    this.logger.debug("Deleting folder", { folderId, deleteContents });

    const result = await this.legacyFolderService.deleteFolder(
      folderId,
      deleteContents
    );

    if (!result.success) {
      if (isRefusedInput(result)) {
        // Folder-not-empty rejection. Per §13.8 the per-error message names
        // the field but never the value; the operator hint stays in logContext.
        throw NextlyError.validation({
          errors: [
            {
              path: "deleteContents",
              code: "INVALID",
              message: "Folder cannot be deleted in its current state.",
            },
          ],
          logContext: {
            folderId,
            legacyMessage: result.message,
            hint: "Set deleteContents=true to delete folder with contents",
          },
        });
      }
      throw this.mapSimpleErrorToNextlyError(result, {
        entity: "folder",
        folderId,
      });
    }

    this.logger.info("Folder deleted", { folderId });
  }

  // ============================================================
  // Image Processing Utilities
  // ============================================================

  /**
   * Check if a file is an image
   *
   * @param mimeType - MIME type to check
   * @returns True if the MIME type is an image type
   */
  isImage(mimeType: string): boolean {
    return isImageMimeType(mimeType);
  }

  /**
   * Validate an image buffer
   *
   * @param buffer - File buffer
   * @returns Whether the buffer is an image, or "unknown" when this install
   *   has no image processing and therefore could not look.
   */
  async validateImage(buffer: Buffer): Promise<ImageValidity> {
    // Forwarded rather than collapsed to a boolean. Squeezing three states
    // into two is what made a missing library read as a bad file, and a
    // wrapper that re-flattens it here would reintroduce that at one remove.
    return this.imageProcessor.isValidImage(buffer);
  }

  /**
   * Get image dimensions
   *
   * @param buffer - Image buffer
   * @returns Dimensions or null if not an image
   */
  async getImageDimensions(
    buffer: Buffer
  ): Promise<{ width: number; height: number } | null> {
    return this.imageProcessor.getDimensions(buffer);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Map legacy media data to MediaFile type
   */
  private mapToMediaFile(data: MediaRow): MediaFile {
    return {
      id: String(data.id),
      filename: data.filename,
      originalFilename: data.originalFilename ?? data.filename,
      mimeType: data.mimeType,
      size: data.size,
      width: data.width,
      height: data.height,
      duration: data.duration,
      url: toAbsoluteMediaUrl(data.url),
      thumbnailUrl: toAbsoluteMediaUrl(data.thumbnailUrl),
      altText: data.altText,
      caption: data.caption,
      tags: data.tags,
      folderId: data.folderId,
      uploadedBy: data.uploadedBy,
      uploadedAt: toMediaDate(data.uploadedAt || data.uploaded_at),
      updatedAt: toMediaDate(data.updatedAt || data.updated_at),
    };
  }

  /**
   * Map legacy folder data to MediaFolder type
   */
  private mapToMediaFolder(data: MediaFolderRow): MediaFolder {
    return {
      id: String(data.id),
      name: data.name,
      description: data.description,
      parentId: data.parentId,
      createdBy: data.createdBy,
      createdAt: toMediaDate(data.createdAt || data.created_at),
      updatedAt: toMediaDate(data.updatedAt || data.updated_at),
    };
  }

  /**
   * Convert legacy result-shape responses (`{ success, statusCode, message, data }`)
   * from the underlying MediaService/MediaFolderService into a NextlyError.
   *
   * The legacy `message` field is treated as operator-only context — it
   * frequently contains driver text or specific identifiers, neither of
   * which §13.8 allows on the public message. The legacy message is stored
   * on logContext and the factory's canonical public message is used.
   */
  /**
   * Rebuild the error a failed media result came from.
   *
   * Through the shared converter, so a media failure and a collection failure
   * with the same meaning answer with the same code. This kept its own status
   * table -- the third in the codebase -- and it disagreed with the others on
   * 409 and 422 while its parameter type omitted `code`, `messageKey` and
   * `publicData` entirely, so every media failure arrived stripped of them.
   *
   * `logContext` carries what the caller knows and the envelope does not: which
   * entity, and which id. Operator-only; it never reaches the wire.
   */
  private mapLegacyErrorToNextlyError(
    result: {
      success: boolean;
      statusCode: number;
      code?: string;
      message: string;
      messageKey?: string;
      publicData?: unknown;
      data: unknown;
    },
    logContext: Record<string, unknown> = {}
  ): NextlyError {
    return errorFromServiceEnvelope(result, {
      legacyStatusCode: result.statusCode,
      legacyMessage: result.message,
      ...logContext,
    });
  }

  /**
   * Convert the simple legacy result-shape (no `data` field) into a
   * NextlyError. Thin adapter over the full mapper.
   */
  private mapSimpleErrorToNextlyError(
    result: {
      success: boolean;
      statusCode: number;
      code?: string;
      message: string;
    },
    logContext: Record<string, unknown> = {}
  ): NextlyError {
    return this.mapLegacyErrorToNextlyError(
      { ...result, data: null },
      logContext
    );
  }
}
