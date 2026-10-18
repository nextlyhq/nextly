/**
 * Media Service
 *
 * Handles CRUD operations for media files with integrated storage and image processing
 *
 * Features:
 * - Auto-detects storage (Vercel Blob, S3, R2, or local filesystem)
 * - Automatic thumbnail generation for images
 * - Image optimization (compression, WebP conversion)
 * - Pagination, search, filtering, sorting
 * - File validation and error handling
 * - Retry logic with exponential backoff for transient storage failures
 *
 * @example
 * ```typescript
 * const mediaService = new MediaService(adapter, logger);
 *
 * // Upload image
 * const result = await mediaService.uploadMedia({
 *   file: buffer,
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 *   size: 1024000,
 *   uploadedBy: userId,
 * });
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, count, desc, asc, or, sql } from "drizzle-orm";

import {
  getMediaStorage,
  getImageProcessor,
  withRetry,
  isTransientError,
  generateImageSizes,
} from "@nextly/storage";

// Actor threading + outbox recording for media writes. Each write records a
// durable `media.*` event in the same transaction as the row change.
import { actorForWrite, type RequestActor } from "../auth/request-actor";
import {
  removeStoredFiles,
  warnNotRemoved,
  warnUnlocated,
} from "../domains/media/remove-stored-files";
import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../domains/media/revalidate-media";
import { variantPaths } from "../domains/media/stored-files";
import type { RetentionRunner } from "../domains/retention/runner";
import type { WebhookFastDrainScheduler } from "../domains/webhooks/after-drain";
import { recordMutationEvent } from "../domains/webhooks/record-mutation-event";
import { keysToSnakeCase } from "../lib/case-conversion";
import { inPluginTransaction } from "../shared/lib/plugin-transaction-scope";
import { refusesUpload } from "../storage/image-processor";
import { siblingStoredPath } from "../storage/stored-path";
import { isImageMimeType, validateFileSize } from "../types/media";
import type {
  Media,
  MediaParams,
  MediaListResponse,
  MediaResponse,
  DeleteMediaResponse,
  UploadMediaInput,
  UpdateMediaInput,
} from "../types/media";

import { BaseService } from "./base-service";
import { ImageSizeService } from "./image-size";
import type { Logger } from "./shared";

/**
 * The shape both legacy bulk media methods report.
 *
 * Named rather than written inline on each signature, because the wrapper that
 * opens the invalidation batch and the fan-out it delegates to must agree on
 * it exactly — two copies of a nine-line structural type are two things to keep
 * in step, and nothing would catch them drifting apart except the next reader.
 */
interface BulkOutcome<TResult> {
  success: boolean;
  totalFiles: number;
  successCount: number;
  failureCount: number;
  results: TResult[];
}

/** Per-file outcome of a bulk upload: positional, since a failure has no id. */
type BulkUploadOutcome = BulkOutcome<{
  filename: string;
  success: boolean;
  data?: Media;
  error?: string;
  statusCode?: number;
}>;

/** Per-id outcome of a bulk delete. */
type BulkDeleteOutcome = BulkOutcome<{
  mediaId: string;
  success: boolean;
  error?: string;
}>;

/**
 * `sizes` as a write stores it: a JSON string, or null. The positional insert
 * and update bind values through the raw driver, which cannot bind a plain
 * object for the json/jsonb/text `sizes` column consistently across all three
 * dialects (SQLite refuses one outright), so every write serializes it here.
 */
function sizesColumn(sizes: unknown): string | null {
  return sizes == null ? null : JSON.stringify(sizes);
}

export class MediaService extends BaseService {
  // Lazy-initialized to avoid capturing a stale MediaStorage singleton
  // before storage plugins are registered via registerServices()
  private get storage() {
    return getMediaStorage();
  }
  private get imageProcessor() {
    return getImageProcessor();
  }

  // A short prune pass on the write path: enough to keep the outbox from
  // growing unbounded without turning a media write into a long maintenance job.
  private static readonly WRITE_PATH_PRUNE_BATCHES = 2;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    /**
     * Shared post-response drain fast path. This service records media outbox
     * events directly, so callers that reach it WITHOUT the unified media
     * service (the exported server actions via `ServiceContainer.media`) still
     * get the immediate drain. Left undefined when the unified service wraps
     * this one (that wrapper offers the drain itself), so the drain is offered
     * exactly once per write.
     */
    private readonly fastDrainScheduler?: WebhookFastDrainScheduler,
    /**
     * Prunes after a write, paired with the drain fast path. The shared runner
     * carries both passes — the webhook outbox and the audit trails — each on
     * its own window and gate, and is absent only when neither has anything to
     * prune.
     */
    private readonly retentionRunner?: RetentionRunner,
    /**
     * The per-file byte cap from the installation's upload policy. Supplied by
     * whoever constructs this service, because the policy is resolved once and
     * this writer is not where it is decided — a default here silently refused
     * files the configured cap permits.
     */
    private readonly maxUploadBytes?: number
  ) {
    super(adapter, logger);
  }

  /**
   * Whether this service's writes would join a plugin's `ctx.db.transaction`
   * as a savepoint the plugin can still roll back. Both conditions hold only
   * on SQLite: the plugin's work is marked as running in its transaction, and
   * the adapter reports one open on the connection this service writes
   * through. On PostgreSQL and MySQL the service writes on its own connection
   * and commits independently, so the adapter reports none.
   */
  private joinsPluginTransaction(): boolean {
    return inPluginTransaction() && this.adapter.inTransaction();
  }

  /**
   * Post-write webhook maintenance for callers that use this service directly:
   * offer the fast drain, then a short retention pass. No-op when no scheduler
   * was injected (the unified media service handles the drain in that path).
   * Both absorb their own failures, so this never turns a committed write into
   * an error.
   */
  private async afterWrite(recorded: boolean): Promise<void> {
    if (!this.fastDrainScheduler && !this.retentionRunner) {
      return;
    }
    // Once the write is durable: a drain started inside an enclosing SQLite
    // transaction would deliver the outbox row it may still roll back.
    await this.afterCommit(async () => {
      // Only schedule the fast drain when an event was actually recorded: an
      // install with no endpoint and audit off records nothing, so offering
      // the drain would pay a fresh `nextly_webhooks` query on every media
      // write for no subscriber. Retention still runs — it prunes prior rows
      // regardless.
      if (recorded) this.fastDrainScheduler?.offer();
      await this.retentionRunner?.maybeRun(
        MediaService.WRITE_PATH_PRUNE_BATCHES
      );
    });
  }

  /**
   * Run `effect` once this service's write is durable: now on PostgreSQL and
   * MySQL, and after the enclosing transaction commits on SQLite. For the
   * unified media service, whose events follow the writes made here.
   */
  whenCommitted(effect: () => unknown): Promise<void> {
    return this.afterCommit(effect);
  }

  /**
   * List media with pagination, search, filtering, and sorting
   */
  async listMedia(params?: MediaParams): Promise<MediaListResponse> {
    try {
      const {
        page = 1,
        limit = 24,
        search,
        type,
        folderId,
        sortBy = "uploadedAt",
        sortOrder = "desc",
      } = params || {};

      const { media } = this.tables;

      const conditions = [];

      if (folderId !== undefined) {
        if (folderId === null || folderId === "root") {
          conditions.push(sql`${media.folderId} IS NULL`);
        } else {
          conditions.push(sql`${media.folderId} = ${folderId}`);
        }
      }

      // Using LOWER() for case-insensitive search across all databases
      if (search) {
        const searchLower = search.toLowerCase();
        conditions.push(
          or(
            sql`LOWER(${media.filename}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${media.originalFilename}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${media.altText}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${media.caption}) LIKE ${`%${searchLower}%`}`
          )
        );
      }

      if (type) {
        conditions.push(sql`${media.mimeType} LIKE ${`${type}/%`}`);
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const orderFn = sortOrder === "asc" ? asc : desc;
      const orderByClause = orderFn(media[sortBy]);

      const offset = (page - 1) * limit;

      const countResult = await this.db
        .select({ value: count() })
        .from(media)
        .where(whereClause);
      const total = Number(countResult[0]?.value ?? 0);

      let query = this.db.select().from(media);

      if (whereClause) {
        query = query.where(whereClause);
      }

      const results = await query
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        statusCode: 200,
        message: `Found ${results.length} media file(s)`,
        data: results as Media[],
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
      };
    } catch (error) {
      console.error("[MediaService] List media error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to fetch media",
        data: null,
      };
    }
  }

  /**
   * Get media by ID
   */
  async getMediaById(mediaId: string): Promise<MediaResponse> {
    try {
      const { media } = this.tables;

      const result = await this.db
        .select()
        .from(media)
        .where(sql`${media.id} = ${mediaId}`)
        .limit(1);

      if (result.length === 0) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Media not found",
          data: null,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "Media retrieved successfully",
        data: result[0] as Media,
      };
    } catch (error) {
      console.error("[MediaService] Get media error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to retrieve media",
        data: null,
      };
    }
  }

  /**
   * Upload media file with automatic processing and storage
   */
  async uploadMedia(
    input: UploadMediaInput,
    actor?: RequestActor
  ): Promise<MediaResponse> {
    try {
      const {
        file,
        filename,
        mimeType,
        uploadedBy,
        folderId,
        contentDisposition,
      } = input;

      /*
       * The BYTES, not the number the caller declared beside them.
       *
       * This method is exported, and a caller states `size` separately from
       * the buffer it hands over, so the two can disagree — by mistake or
       * deliberately. Checking the declared number let a caller pass a cap it
       * exceeded, and storing it wrote a row that misdescribes its own object,
       * which every later reader then has to distrust. Measuring here is what
       * makes the row true by construction rather than by callers being
       * careful.
       */
      const storedSize = file.length;
      const sizeValidation = validateFileSize(storedSize, this.maxUploadBytes);
      if (!sizeValidation.valid) {
        return {
          success: false,
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: sizeValidation.error || "Invalid file size",
          data: null,
        };
      }

      const isImage = isImageMimeType(mimeType);
      let width: number | null = null;
      let height: number | null = null;
      let thumbnailUrl: string | null = null;

      if (isImage) {
        const validity = await this.imageProcessor.isValidImage(file);
        // Asked rather than re-derived here, so the rule lives in one place
        // and is testable without the whole upload harness.
        if (refusesUpload(validity)) {
          return {
            success: false,
            statusCode: 400,
            code: "VALIDATION_ERROR",
            message: "Invalid image file",
            data: null,
          };
        }

        const dimensions = await this.imageProcessor.getDimensions(file);
        if (dimensions) {
          width = dimensions.width;
          height = dimensions.height;
        }

        try {
          const thumbnail = await this.imageProcessor.generateThumbnail(file);
          // Null means no image processing on this install. The upload keeps
          // its file and simply carries no thumbnail, rather than failing for
          // a derived artefact that was never essential to storing it.
          if (thumbnail) {
            const thumbnailFilename = `thumb_${filename}`;
            const thumbnailResult = await withRetry(
              () =>
                this.storage.upload(thumbnail.buffer, {
                  filename: thumbnailFilename,
                  mimeType: "image/jpeg",
                  collection: "media",
                }),
              {
                maxAttempts: 3,
                baseDelayMs: 500,
                shouldRetry: isTransientError,
                onRetry: (err, attempt) => {
                  console.warn(
                    `[MediaService] Thumbnail upload retry ${attempt}:`,
                    err instanceof Error ? err.message : err
                  );
                },
              }
            );
            thumbnailUrl = thumbnailResult.url;
          }
        } catch (error) {
          console.warn("[MediaService] Thumbnail generation failed:", error);
          // Continue without thumbnail
        }
      }

      const uploadResult = await withRetry(
        () =>
          this.storage.upload(file, {
            filename,
            mimeType,
            collection: "media",
            // Forward when set; storage adapters that don't honor
            // per-object disposition silently no-op (storage-local) or
            // refuse the upload entirely (storage-vercel-blob).
            ...(contentDisposition && { contentDisposition }),
          }),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          shouldRetry: isTransientError,
          onRetry: (err, attempt) => {
            console.warn(
              `[MediaService] Upload retry ${attempt}:`,
              err instanceof Error ? err.message : err
            );
          },
        }
      );

      let sizesData: Record<string, unknown> | null = null;
      if (isImage) {
        try {
          const imageSizeService = new ImageSizeService(
            this.adapter,
            this.logger
          );
          const sizeConfigs = await imageSizeService.getActiveSizeConfigs();

          if (sizeConfigs.length > 0) {
            const uploadFn = async (
              buffer: Buffer,
              opts: {
                filename: string;
                mimeType: string;
                folder?: string;
                collection?: string;
              }
            ) => {
              return this.storage.upload(buffer, {
                filename: opts.filename,
                mimeType: opts.mimeType,
                collection: "media",
              });
            };

            sizesData = await generateImageSizes(
              file,
              filename,
              sizeConfigs,
              uploadFn
            );

            // Use the thumbnail from named sizes if available (backward compat)
            if (sizesData && "thumbnail" in sizesData) {
              const thumbVariant = sizesData.thumbnail as { url: string };
              thumbnailUrl = thumbnailUrl ?? thumbVariant.url;
            }
          }
        } catch (error) {
          console.warn("[MediaService] Image size generation failed:", error);
          // Continue without sizes - not a critical failure
        }
      }

      const now = new Date();
      const mediaId = crypto.randomUUID();

      const mediaRecord = {
        id: mediaId,
        filename: uploadResult.path,
        originalFilename: filename,
        mimeType,
        size: storedSize,
        width,
        height,
        duration: null,
        url: uploadResult.url,
        thumbnailUrl,
        altText: null,
        caption: null,
        tags: null,
        focalX: null,
        focalY: null,
        sizes: sizesData ?? null,
        folderId: folderId ?? null,
        uploadedBy,
        uploadedAt: now,
        updatedAt: now,
      };

      // Persist the row and record the outbox event in one transaction so the
      // event is durable exactly when the insert commits, and never for a write
      // that later rolls back. The positional adapter transaction is required
      // because recordMutationEvent writes through the adapter's
      // TransactionContext, not the Drizzle fluent transaction. `sizes` is
      // serialized up front (`sizesColumn`).
      const insertRow = keysToSnakeCase({
        ...mediaRecord,
        sizes: sizesColumn(sizesData),
      }) as Record<string, unknown>;

      let recorded = false;
      await this.adapter.transaction(async tx => {
        await tx.insert("media", insertRow, { returning: [] });

        // `data` is the just-created row in read shape; a fresh upload has no
        // prior state, so `previous` is null. Media has no field schema, so
        // `fields` is empty (nothing to strip). The uploader is the recorded
        // subject when no transport actor was threaded.
        recorded = await recordMutationEvent(tx, {
          type: "media.uploaded",
          resource: { kind: "media", id: mediaId },
          data: mediaRecord,
          previous: null,
          fields: [],
          actor: actorForWrite(actor, uploadedBy ? { id: uploadedBy } : null),
        });
      });

      // The row is visible to readers the moment the transaction commits, so
      // invalidate here rather than after the drain and retention pass below.
      // Inside an enclosing SQLite transaction, "commits" means its commit.
      await this.afterCommit(() => revalidateMedia([mediaId], this.logger));

      // The upload committed a media.uploaded outbox row; drain and prune it
      // (no-op when the unified media service wraps this one and drains itself).
      await this.afterWrite(recorded);

      return {
        success: true,
        statusCode: 201,
        message: "Media uploaded successfully",
        data: mediaRecord as unknown as Media,
      };
    } catch (error) {
      console.error("[MediaService] Upload media error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to upload media",
        data: null,
      };
    }
  }

  /**
   * Insert a random token before a filename's extension so any destination
   * derived from it is unique: `photo.jpg` -> `photo-<token>.jpg` (a name with
   * no extension gets the token appended). Used to guarantee regenerated
   * focal-crop variants never reuse the item's existing storage keys, even on a
   * storage adapter that maps a filename to a fixed path.
   */
  private uniqueVariantBaseName(filename: string): string {
    const token = crypto.randomUUID();
    const lastDot = filename.lastIndexOf(".");
    if (lastDot > 0) {
      return `${filename.slice(0, lastDot)}-${token}${filename.slice(lastDot)}`;
    }
    return `${filename}-${token}`;
  }

  /**
   * Regenerate a media item's image size variants for a changed crop point,
   * writing `sizes`/`thumbnailUrl` onto `updateData` and returning the newly
   * generated sizes (or null when nothing was regenerated). No-op unless the
   * crop actually changed and the item is an image on a readable storage
   * adapter.
   *
   * The new variants are written to fresh storage keys — a random token is
   * injected into the destination filename here so they can NEVER land on the
   * item's existing variant keys, even on a storage adapter that derives a
   * deterministic path from the filename rather than prefixing its own random
   * id. This never overwrites the item's existing variant bytes and never
   * deletes them: content-addressing plus a delete-after-commit in `updateMedia`
   * is what makes this safe. Deleting the old paths here — before the row commits
   * — was the previous bug: a rollback or a concurrent edit left the committed
   * row pointing at bytes that were already gone. The old paths are now cleaned
   * up by the caller only after the row durably points at the new ones. Kept
   * OUTSIDE the write transaction on purpose: it must not hold the row lock (or a
   * single-connection pool) across slow storage I/O.
   *
   * Best-effort: a regeneration failure is swallowed (the crop point is still
   * saved against the existing variants) rather than failing the whole update.
   */
  private async regenerateFocalPointSizes(
    media: Media,
    changes: UpdateMediaInput,
    updateData: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const focalPointChanged =
      changes.focalX !== undefined || changes.focalY !== undefined;
    if (!focalPointChanged || !isImageMimeType(media.mimeType)) {
      return null;
    }

    const adapter = this.storage.getAdapterForCollection("media");
    if (!adapter.read) {
      console.log(
        `[MediaService] Crop point saved for media ${media.id}. ` +
          `Size regeneration requires local storage or adapter with read support.`
      );
      return null;
    }

    try {
      const originalBuffer = await adapter.read(media.filename);
      if (!originalBuffer) return null;

      const imageSizeService = new ImageSizeService(this.adapter, this.logger);
      const sizeConfigs = await imageSizeService.getActiveSizeConfigs();
      if (sizeConfigs.length === 0) return null;

      const uploadFn = async (
        buffer: Buffer,
        opts: { filename: string; mimeType: string }
      ) => {
        return this.storage.upload(buffer, {
          filename: opts.filename,
          mimeType: opts.mimeType,
          collection: "media",
        });
      };
      // Force a unique destination base so the regenerated variant keys cannot
      // collide with the item's existing ones on a deterministic (filename ->
      // fixed path) storage adapter. On a collision, an overwrite-disallowing
      // adapter would fail the upload (saving the crop without new thumbnails)
      // and an overwrite-allowing one would mutate the bytes the committed row
      // still points at before this transaction commits — both break the
      // content-addressed delete-after-commit contract updateMedia relies on.
      const uniqueBase = this.uniqueVariantBaseName(
        media.originalFilename || media.filename
      );
      const newSizes = await generateImageSizes(
        originalBuffer,
        uniqueBase,
        sizeConfigs,
        uploadFn,
        { focalX: changes.focalX, focalY: changes.focalY }
      );

      updateData.sizes = newSizes;
      if (newSizes && "thumbnail" in newSizes) {
        updateData.thumbnailUrl = (
          newSizes.thumbnail as unknown as { url: string }
        ).url;
      }

      console.log(
        `[MediaService] Regenerated ${Object.keys(newSizes).length} sizes for media ${media.id}`
      );
      return newSizes;
    } catch (error) {
      console.warn(
        "[MediaService] Crop point size regeneration failed:",
        error
      );
      // Continue without regeneration - crop point is still saved.
      return null;
    }
  }

  /**
   * Best-effort deletion of a set of variant storage paths. Used to clean up
   * either the superseded old variants (after a rotation commits) or the
   * freshly-written new variants (when the commit did not happen), so neither a
   * successful regeneration nor a failed one leaks storage. Never throws: a
   * failed delete is logged, naming the file and its item so a leftover can be
   * found, because the durable DB state is already correct and an orphaned file
   * is not worth failing or reversing the write over.
   */
  private async deleteVariantPaths(
    paths: string[],
    mediaId: string
  ): Promise<void> {
    await Promise.all(
      paths.map(async filePath => {
        try {
          await this.storage.delete(filePath, "media");
        } catch (error) {
          warnNotRemoved(filePath, mediaId, error);
        }
      })
    );
  }

  /**
   * Extract the storage paths from a `sizes` value (an object keyed by size name,
   * each holding `{ path, ... }`), tolerating the DB's JSON-string form. Used to
   * decide which variant files to delete after a rotation without touching any
   * that the new set reuses.
   */
  /**
   * Delete the variant paths in `candidateSizes` that are NOT among the paths
   * `keepSizes` references. Used for every variant cleanup so a deterministic-key
   * adapter (where a regenerated variant can reuse an existing path) never
   * deletes a file the surviving row still points at: after commit `keepSizes`
   * is the new sizes and `candidateSizes` the superseded old ones; on a failed or
   * void write it is the reverse — the old sizes survive on the un-updated row,
   * so only the genuinely-orphaned new uploads are removed.
   */
  private async deleteSupersededVariants(
    candidateSizes: unknown,
    keepSizes: unknown,
    mediaId: string,
    /** Other superseded files, such as a thumbnail the new sizes replaced. */
    alsoSuperseded: readonly string[] = []
  ): Promise<void> {
    const keep = new Set(this.collectVariantPaths(keepSizes));
    const candidates = new Set([
      ...this.collectVariantPaths(candidateSizes),
      ...alsoSuperseded,
    ]);
    await this.deleteVariantPaths(
      [...candidates].filter(path => !keep.has(path)),
      mediaId
    );
  }

  /**
   * The stored path of the thumbnail `current` has, when `updateData` gives the
   * item another one. Undefined when it keeps its thumbnail, has none, or one
   * whose location the record does not show, which is then named in the log.
   */
  private replacedThumbnailPath(
    current: Media,
    updateData: Record<string, unknown>
  ): string | undefined {
    const old = current.thumbnailUrl;
    const next = updateData.thumbnailUrl;
    if (!old || next === undefined || next === old) return undefined;
    const found = siblingStoredPath(
      { path: current.filename, url: current.url },
      old
    );
    if (!found) warnUnlocated(old, current.id);
    return found;
  }

  private collectVariantPaths(sizes: unknown): string[] {
    return variantPaths(sizes);
  }

  /**
   * Update media metadata (altText, caption, tags)
   */
  async updateMedia(
    mediaId: string,
    changes: UpdateMediaInput,
    actor?: RequestActor
  ): Promise<MediaResponse> {
    try {
      const existing = await this.getMediaById(mediaId);
      if (!existing.success) {
        return existing;
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (changes.altText !== undefined) updateData.altText = changes.altText;
      if (changes.caption !== undefined) updateData.caption = changes.caption;
      if (changes.tags !== undefined) updateData.tags = changes.tags;
      if (changes.focalX !== undefined) updateData.focalX = changes.focalX;
      if (changes.focalY !== undefined) updateData.focalY = changes.focalY;
      // A folder move (including to root, `null`) rides the same update path so
      // the change is captured as a media.updated event.
      if (changes.folderId !== undefined)
        updateData.folderId = changes.folderId;

      // Regenerate focal-point image variants when the crop changed, before the
      // write transaction opens (storage I/O must not hold the row lock). The
      // new variants go to fresh, unique keys and the OLD ones are left in place;
      // the row is then committed pointing at the new keys and the superseded old
      // ones are deleted only AFTER the commit. So a rollback or a lost update
      // race never leaves the committed row referencing bytes that were already
      // deleted — the previous, now-fixed dual-write bug. Returns the new sizes
      // (or null) so a failed/void write can clean up its own orphaned uploads.
      const regeneratedSizes = await this.regenerateFocalPointSizes(
        existing.data!,
        changes,
        updateData
      );
      // Commit the row update and its outbox event in one transaction so the
      // event is durable exactly when the change commits. The row is locked and
      // RE-READ inside the transaction (not reused from the pre-transaction
      // read): the fresh read reflects the latest committed state, so a row
      // removed by a concurrent delete is detected reliably on every dialect
      // (a bare update-then-select-back can return a stale snapshot row on
      // MySQL's repeatable read), and a field another request committed after
      // our first read is not shipped stale. The transaction returns the
      // post-update document (or null when the row is already gone).
      //
      // The superseded variant paths are captured from the locked row here, not
      // from the pre-transaction read, so two concurrent focal edits each delete
      // exactly the paths their own commit replaced rather than one clobbering
      // the other's fresh variants.
      let replacedSizes: unknown = null;
      // The upload-time thumbnail the regenerated sizes replace, when they
      // bring a `thumbnail` of their own: from then on nothing refers to it.
      let replacedThumbnail: string | undefined;
      let updatedRow: Media | null;
      let recorded = false;
      try {
        updatedRow = await this.adapter.transaction<Media | null>(async tx => {
          await tx.lockRow("media", mediaId);
          const currentRows = await tx.select<Media>("media", {
            where: this.whereEq("id", mediaId),
          });
          const current = currentRows[0];
          // Lost an update race: the row was deleted after our first read, so
          // record nothing and let the not-found result below stand.
          if (!current) {
            return null;
          }

          if (regeneratedSizes) {
            replacedSizes = (current as unknown as Record<string, unknown>)
              .sizes;
            replacedThumbnail = this.replacedThumbnailPath(current, updateData);
          }

          // Regenerated sizes are serialized as the upload writes them
          // (`sizesColumn`); `updateData` keeps the object for the event and
          // the response below.
          await tx.update(
            "media",
            "sizes" in updateData
              ? { ...updateData, sizes: sizesColumn(updateData.sizes) }
              : updateData,
            this.whereEq("id", mediaId)
          );

          // The post-update document: the freshly-read committed row overlaid
          // with ONLY this write's columns (`updateData` holds each supplied
          // change plus any regenerated sizes/thumbnail and the fresh
          // updatedAt, keyed in the same camelCase as the read row). Reused as
          // both the event `data` and the response body so they never drift.
          const nextRow: Media = { ...current, ...updateData };

          // `previous` is the freshly-read pre-write row; `data` is the new
          // state. Media has no field schema, so `fields` is empty.
          recorded = await recordMutationEvent(tx, {
            type: "media.updated",
            resource: { kind: "media", id: mediaId },
            data: nextRow,
            previous: current,
            fields: [],
            actor: actorForWrite(actor, null),
          });

          return nextRow;
        });
      } catch (error) {
        // The write failed after new variants were uploaded to fresh keys: those
        // uploads are orphaned. Delete them — but keep any that the un-updated
        // row still references (a deterministic adapter can reuse an old path),
        // so a failed regeneration never removes a live variant. Prefer
        // `replacedSizes` (read UNDER THE LOCK, so it reflects a variant set a
        // concurrent update committed after our pre-transaction read); fall back
        // to the pre-transaction read only when the transaction failed before it
        // reached the locked row. Then propagate.
        if (regeneratedSizes) {
          await this.deleteSupersededVariants(
            regeneratedSizes,
            replacedSizes ??
              (existing.data as { sizes?: unknown } | null)?.sizes,
            mediaId
          );
        }
        throw error;
      }

      // Ahead of the variant cleanup below for the same reason the delete path
      // invalidates ahead of its storage work: the row has changed, so a cached
      // page is already wrong, and file cleanup can retry for a long time.
      // Inside an enclosing SQLite transaction, once that commits.
      if (updatedRow) {
        await this.afterCommit(() => revalidateMedia([mediaId], this.logger));
      }

      if (!updatedRow) {
        // Concurrent delete: the row was not updated, so the freshly-uploaded
        // variants are orphaned. Same guard as the failure path — keep anything
        // the surviving row still references — before returning not-found. Here
        // the locked read found no row (so `replacedSizes` stayed null) and the
        // fallback to the pre-transaction read supplies the paths to keep.
        if (regeneratedSizes) {
          await this.deleteSupersededVariants(
            regeneratedSizes,
            replacedSizes ??
              (existing.data as { sizes?: unknown } | null)?.sizes,
            mediaId
          );
        }
        // Mirror getMediaById's not-found shape so the domain layer maps this to
        // a 404 instead of treating the no-op write as a successful update.
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Media not found",
          data: null,
        };
      }

      // The row now references the new variants, so the superseded old ones
      // can be deleted (keeping any path the new set reuses). An item stored
      // with no sizes has none to replace, and may still have an upload-time
      // thumbnail the new sizes replace.
      if (regeneratedSizes && (replacedSizes || replacedThumbnail)) {
        // Once the change is durable, as for a delete: inside an enclosing
        // SQLite transaction, core's or a plugin's `ctx.db.transaction`, the
        // update is a savepoint of it, and a rollback brings back the row
        // that refers to the superseded variants. The deletion then waits for
        // that transaction to commit, and is dropped if it rolls back.
        const superseded = replacedSizes;
        const thumbnail = replacedThumbnail;
        await this.afterCommit(() =>
          this.deleteSupersededVariants(
            superseded,
            regeneratedSizes,
            mediaId,
            thumbnail ? [thumbnail] : []
          )
        );
      }

      // The update committed a media.updated outbox row; drain and prune it
      // (no-op when the unified media service wraps this one and drains itself).
      await this.afterWrite(recorded);

      return {
        success: true,
        statusCode: 200,
        message: "Media updated successfully",
        data: updatedRow,
      };
    } catch (error) {
      console.error("[MediaService] Update media error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to update media",
        data: null,
      };
    }
  }

  /**
   * Delete media file (removes from storage and database)
   *
   * Refused inside a plugin's `ctx.db.transaction` on SQLite, which this
   * delete would join. Its row delete would be a savepoint of that
   * transaction, but the stored files go when the savepoint releases: the
   * plugin's later rollback would bring the row back pointing at files that
   * no longer exist. Core's own enclosing transactions (a collection hook
   * deleting media during an entry write) are not refused.
   */
  async deleteMedia(
    mediaId: string,
    actor?: RequestActor
  ): Promise<DeleteMediaResponse> {
    // A precondition, ahead of every read and write, so a refused delete
    // touches neither the row nor storage.
    if (this.joinsPluginTransaction()) {
      return {
        success: false,
        statusCode: 409,
        code: "CONFLICT",
        message:
          "Media cannot be deleted inside a database transaction. Delete it after the transaction, not inside it.",
      };
    }
    try {
      const existing = await this.getMediaById(mediaId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Media not found",
        };
      }

      // Remove the row and record the outbox event in one transaction FIRST,
      // before touching physical storage. The database is the source of truth,
      // so the row deletion and its durable event commit together; storage
      // cleanup runs afterward. If that cleanup fails it leaves an orphaned FILE
      // (benign, later reclaimable) rather than a surviving ROW pointing at an
      // already-deleted file (a real read bug). The row is locked and RE-READ
      // inside the transaction so a row already removed by a concurrent request
      // is detected reliably on every dialect, and the event's `data` carries
      // the latest committed state rather than the pre-transaction read. The
      // transaction returns the deleted row (or null when it was already gone).
      let recorded = false;
      const deletedRow = await this.adapter.transaction<Media | null>(
        async tx => {
          await tx.lockRow("media", mediaId);
          const currentRows = await tx.select<Media>("media", {
            where: this.whereEq("id", mediaId),
          });
          const current = currentRows[0];
          // Lost a delete race: the row is already gone, so record nothing.
          // Only the request that actually removes the row emits media.deleted.
          if (!current) {
            return null;
          }

          await tx.delete("media", this.whereEq("id", mediaId));

          // The removed row's final state ships as `data`; there is no
          // post-delete state, so `previous` is null (mirroring create). Media
          // has no field schema, so `fields` is empty (nothing to strip).
          recorded = await recordMutationEvent(tx, {
            type: "media.deleted",
            resource: { kind: "media", id: mediaId },
            data: current,
            previous: null,
            fields: [],
            actor: actorForWrite(actor, null),
          });

          return current;
        }
      );

      // The row was gone before we could delete it: report not-found and skip
      // physical cleanup (the winning request owns the file) rather than
      // returning a false success for a no-op delete.
      if (!deletedRow) {
        return {
          success: false,
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Media not found",
        };
      }
      const mediaData = deletedRow;

      // Invalidated here, not after the cleanup below. The row is already gone,
      // so a cached page is already wrong; deferring past storage deletes and
      // their retry backoffs leaves it wrong for as long as that takes, and a
      // storage call that hangs until the request is killed would leave it
      // wrong permanently despite a committed delete. Inside an enclosing
      // SQLite transaction the delete is durable only once that commits.
      await this.afterCommit(() => revalidateMedia([mediaId], this.logger));

      // Best-effort physical cleanup AFTER the row + event have committed:
      // a storage failure must not fail a delete whose authoritative row
      // removal already succeeded. Every stored file is removed on its own,
      // so one that fails leaves the others to go, and is named in the log
      // with its item, so the leftover can be found.
      //
      // Once the delete is durable: inside an enclosing SQLite transaction
      // this delete is a savepoint of it, and a rollback would bring the row
      // back pointing at files already gone.
      await this.afterCommit(() =>
        removeStoredFiles(this.storage, mediaData, mediaId)
      );

      // The delete committed a media.deleted outbox row; drain and prune it
      // (no-op when the unified media service wraps this one and drains itself).
      await this.afterWrite(recorded);

      return {
        success: true,
        statusCode: 200,
        message: "Media deleted successfully",
      };
    } catch (error) {
      console.error("[MediaService] Delete media error:", error);
      return {
        success: false,
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to delete media",
      };
    }
  }

  /**
   * Upload multiple media files in parallel (with concurrency limit)
   *
   * Uploads files in batches of 5 concurrent uploads to avoid overwhelming
   * the server while still providing good performance.
   *
   * @param inputs - Array of files to upload
   * @returns Object with success status and individual results for each file
   *
   * @example
   * ```typescript
   * const result = await mediaService.uploadMediaBulk([
   *   { file: buffer1, filename: 'photo1.jpg', mimeType: 'image/jpeg', size: 1024, uploadedBy: userId },
   *   { file: buffer2, filename: 'photo2.jpg', mimeType: 'image/jpeg', size: 2048, uploadedBy: userId },
   * ]);
   *
   * console.log(`Uploaded ${result.results.filter(r => r.success).length} of ${result.results.length} files`);
   * result.results.forEach(r => {
   *   if (r.success) {
   *     console.log(`✓ ${r.filename}`);
   *   } else {
   *     console.log(`✗ ${r.filename}: ${r.error}`);
   *   }
   * });
   * ```
   */
  async uploadMediaBulk(
    inputs: UploadMediaInput[]
  ): Promise<BulkUploadOutcome> {
    // ONE shared-tag flush for the whole fan-out. Each file below reaches
    // `uploadMedia`, which invalidates against its own commit; without a scope
    // here N files re-invalidate the `nextly:media` tag they all share. The
    // rows' own tags still go at commit time — see `withMediaRevalidationBatch`.
    return withMediaRevalidationBatch(
      () => this.uploadMediaBulkFanOut(inputs),
      this.logger
    );
  }

  /**
   * The per-file fan-out, split out so the method above owns nothing but the
   * batch scope its invalidation needs.
   */
  private async uploadMediaBulkFanOut(
    inputs: UploadMediaInput[]
  ): Promise<BulkUploadOutcome> {
    const results: Array<{
      filename: string;
      success: boolean;
      data?: Media;
      error?: string;
      statusCode?: number;
    }> = [];

    const CHUNK_SIZE = 5;
    const chunks: UploadMediaInput[][] = [];

    for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
      chunks.push(inputs.slice(i, i + CHUNK_SIZE));
    }

    // Process each chunk sequentially, but files within chunk in parallel
    for (const chunk of chunks) {
      const promises = chunk.map(async input => {
        try {
          const result = await this.uploadMedia(input);
          return {
            filename: input.filename,
            success: result.success,
            data: result.data || undefined,
            error: result.success ? undefined : result.message,
            statusCode: result.statusCode,
          };
        } catch (error) {
          return {
            filename: input.filename,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            statusCode: 500,
            code: "INTERNAL_ERROR",
          };
        }
      });

      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return {
      success: successCount > 0,
      totalFiles: inputs.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Delete multiple media files in parallel
   *
   * @param mediaIds - Array of media IDs to delete
   * @returns Object with success status and individual results
   */
  async deleteMediaBulk(mediaIds: string[]): Promise<BulkDeleteOutcome> {
    // ONE shared-tag flush for the whole fan-out — see `uploadMediaBulk`.
    return withMediaRevalidationBatch(
      () => this.deleteMediaBulkFanOut(mediaIds),
      this.logger
    );
  }

  /**
   * The per-id fan-out, split out so the method above owns nothing but the
   * batch scope its invalidation needs.
   */
  private async deleteMediaBulkFanOut(
    mediaIds: string[]
  ): Promise<BulkDeleteOutcome> {
    const results: Array<{
      mediaId: string;
      success: boolean;
      error?: string;
    }> = [];

    const CHUNK_SIZE = 10;
    const chunks: string[][] = [];

    for (let i = 0; i < mediaIds.length; i += CHUNK_SIZE) {
      chunks.push(mediaIds.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async mediaId => {
        try {
          const result = await this.deleteMedia(mediaId);
          return {
            mediaId,
            success: result.success,
            error: result.success ? undefined : result.message,
          };
        } catch (error) {
          return {
            mediaId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return {
      success: successCount > 0,
      totalFiles: mediaIds.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Get storage type being used
   */
  getStorageType(): string {
    return this.storage.getStorageType();
  }
}
