/**
 * Media Service
 *
 * Handles CRUD operations for media files with integrated storage and image processing
 *
 * Features:
 * - Auto-detects storage (Vercel Blob, S3, R2, or local filesystem)
 * - Automatic thumbnail generation for images: the whole image, fitted
 *   inside 480x480. No other size is made.
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
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { count, desc, asc, eq, sql } from "drizzle-orm";

import {
  getMediaStorage,
  getImageProcessor,
  withRetry,
  isTransientError,
} from "@nextly/storage";

// Actor threading + outbox recording for media writes. Each write records a
// durable `media.*` event in the same transaction as the row change.
import { actorForWrite, type RequestActor } from "../auth/request-actor";
import type {
  MediaLibraryCounts,
  UnusedSources,
} from "../domains/media/media-library-query";
import {
  errorForLog,
  filesKeptByOthers,
  removeStoredFiles,
  type StoredFileSearch,
} from "../domains/media/remove-stored-files";
import { storedSizesOf } from "../domains/media/retired-image-sizes-store";
import {
  revalidateMedia,
  withMediaRevalidationBatch,
} from "../domains/media/revalidate-media";
import { StoredFileSearchReader } from "../domains/media/stored-file-search";
import { storedFilesOf } from "../domains/media/stored-files";
import type { RetentionRunner } from "../domains/retention/runner";
import type { WebhookFastDrainScheduler } from "../domains/webhooks/after-drain";
import { recordMutationEvent } from "../domains/webhooks/record-mutation-event";
import { keysToSnakeCase } from "../lib/case-conversion";
import { withoutStoredSizes } from "../lib/media-variant";
import { inPluginTransaction } from "../shared/lib/plugin-transaction-scope";
import { refusesUpload } from "../storage/image-processor";
import { isImageMimeType, validateFileSize } from "../types/media";
import type {
  Media,
  MediaParams,
  MediaListResponse,
  MediaResponse,
  DeleteMediaResponse,
  UploadMediaInput,
  UpdateMediaInput,
  MediaView,
} from "../types/media";

import { BaseService } from "./base-service";
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
 * A media row as the table holds it. One stored before image sizes were
 * removed may still carry `sizes`, which only the removal of its files reads:
 * every row this service hands back goes through `withoutStoredSizes`.
 */
type StoredMediaRow = Media & { sizes?: unknown };

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

  /** How this service reads the media rows that may share a file (filesKeptByOthers). */
  /**
   * The item's row, locked and re-read inside `tx` so a write sees the
   * latest committed state, or undefined when a concurrent delete removed it.
   */
  private async lockedRow(
    tx: TransactionContext,
    mediaId: string
  ): Promise<StoredMediaRow | undefined> {
    await tx.lockRow("media", mediaId);
    const rows = await tx.select<StoredMediaRow>("media", {
      where: this.whereEq("id", mediaId),
    });
    return rows[0];
  }

  private get storedFileSearch(): StoredFileSearch {
    return new StoredFileSearchReader(this.adapter, this.logger).search;
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
   * What decides which items are unused: the usage table and the records
   * outside content that keep an item by its address. `null` before
   * `nextly migrate` has created the usage table. Asked on the pool: nothing
   * here runs inside a caller's transaction.
   */
  private async unusedSources(): Promise<UnusedSources | null> {
    // Loaded when the library is read, not with the service.
    const [{ mediaUsagePresent }, { mediaAddressHolders }] = await Promise.all([
      import("../domains/media/usage/media-usage-store"),
      import("../domains/media/media-address-holders"),
    ]);
    if (!(await mediaUsagePresent(this.adapter, this.logger))) return null;
    return {
      usage: this.tables.nextlyMediaUsage,
      holders: await mediaAddressHolders(this.adapter, this.tables),
      dialect: this.adapter.getCapabilities().dialect,
    };
  }

  /**
   * The sidebar's counts, in one query: every folder's items (and the items
   * in no folder), and each view's. Grouped by folder, with each view's
   * condition summed inside the group, so the whole library is read once
   * and nothing is counted in the application.
   *
   * `unused` is `null` before `nextly migrate` has created the usage table.
   * `usageRecorded` says whether the record has been built for content
   * written before it existed (`nextly media reindex-usage`): until then an
   * item that content uses can read as unused.
   */
  async countLibrary(): Promise<MediaLibraryCounts> {
    const { media, nextlyMeta } = this.tables;
    const unused = await this.unusedSources();
    // Loaded when the library is read, not with the service.
    const [
      { mediaLibraryCountsOf, missingAltText, unusedItem },
      { MEDIA_USAGE_RECORDED_KEY },
    ] = await Promise.all([
      import("../domains/media/media-library-query"),
      import("../domains/media/usage/media-usage-store"),
    ]);
    const groups = await this.db
      .select({
        folderId: media.folderId,
        items: count(),
        missingAlt: sql<
          number | string | null
        >`SUM(CASE WHEN ${missingAltText(media)} THEN 1 ELSE 0 END)`,
        unused: unused
          ? sql<
              number | string | null
            >`SUM(CASE WHEN ${unusedItem(media, unused)} THEN 1 ELSE 0 END)`
          : sql<number>`0`,
        // At most one marker row joins each item, so it multiplies nothing.
        recorded: sql<
          number | string | null
        >`MAX(CASE WHEN ${nextlyMeta.key} IS NULL THEN 0 ELSE 1 END)`,
      })
      .from(media)
      .leftJoin(nextlyMeta, eq(nextlyMeta.key, MEDIA_USAGE_RECORDED_KEY))
      .groupBy(media.folderId);
    return mediaLibraryCountsOf(groups, unused !== null);
  }

  /**
   * List media with pagination, search, filtering, and sorting
   */
  async listMedia(
    params?: MediaParams & { view?: MediaView }
  ): Promise<MediaListResponse> {
    try {
      const {
        page = 1,
        limit = 24,
        search,
        type,
        folderId,
        view,
        sortBy = "uploadedAt",
        sortOrder = "desc",
      } = params || {};

      const { media } = this.tables;

      // The same narrowing a folder's contents and the sidebar's counts use,
      // loaded when the library is read, not with the service.
      const { mediaQueryCondition } = await import(
        "../domains/media/media-library-query"
      );
      const whereClause = mediaQueryCondition(
        media,
        view === "unused" ? await this.unusedSources() : null,
        { folderId, search, type, view }
      );

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
        data: (results as StoredMediaRow[]).map(row => withoutStoredSizes(row)),
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
      };
    } catch (error) {
      this.logger.error("[MediaService] List media error", { error: error });
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
        data: withoutStoredSizes(result[0] as StoredMediaRow),
      };
    } catch (error) {
      this.logger.error("[MediaService] Get media error", { error: error });
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
        altText,
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
                  // A storage error can quote a signed URL; errorForLog
                  // strips its credentials and query before it is logged.
                  this.logger.warn(
                    `[MediaService] Thumbnail upload retry ${attempt}`,
                    { error: errorForLog(err) }
                  );
                },
              }
            );
            thumbnailUrl = thumbnailResult.url;
          }
        } catch (error) {
          this.logger.warn("[MediaService] Thumbnail generation failed", {
            error: errorForLog(error),
          });
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
            this.logger.warn(`[MediaService] Upload retry ${attempt}`, {
              error: errorForLog(err),
            });
          },
        }
      );

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
        // The upload's own alt text: writing `null` here dropped what every
        // caller gave.
        altText: altText ?? null,
        caption: null,
        tags: null,
        focalX: null,
        focalY: null,
        // No `sizes`: an upload stores the original and its thumbnail only.
        folderId: folderId ?? null,
        uploadedBy,
        uploadedAt: now,
        updatedAt: now,
      };

      // Persist the row and record the outbox event in one transaction so the
      // event is durable exactly when the insert commits, and never for a write
      // that later rolls back. The positional adapter transaction is required
      // because recordMutationEvent writes through the adapter's
      // TransactionContext, not the Drizzle fluent transaction.
      const insertRow = keysToSnakeCase(mediaRecord) as Record<string, unknown>;

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
      this.logger.error("[MediaService] Upload media error", { error: error });
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
   * Update media metadata: alt text, caption, tags, the focus point and the
   * folder. Writes the row only; no stored file changes.
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

      // A moved focus point is saved and nothing else: no image is cut
      // around it, so no file is read or stored.
      //
      // Commit the row update and its outbox event in one transaction so the
      // event is durable exactly when the change commits. The row is locked and
      // RE-READ inside the transaction (not reused from the pre-transaction
      // read): the fresh read reflects the latest committed state, so a row
      // removed by a concurrent delete is detected reliably on every dialect
      // (a bare update-then-select-back can return a stale snapshot row on
      // MySQL's repeatable read), and a field another request committed after
      // our first read is not shipped stale. The transaction returns the
      // post-update document (or null when the row is already gone).
      let recorded = false;
      const updatedRow = await this.adapter.transaction<Media | null>(
        async tx => {
          const stored = await this.lockedRow(tx, mediaId);
          // Lost an update race: the row was deleted after our first read, so
          // record nothing and let the not-found result below stand.
          if (!stored) {
            return null;
          }

          await tx.update("media", updateData, this.whereEq("id", mediaId));

          // The post-update document: the freshly-read committed row overlaid
          // with ONLY this write's columns (`updateData` holds each supplied
          // change and the fresh updatedAt, keyed in the same camelCase as the
          // read row). Reused as both the event `data` and the response body
          // so they never drift. Neither carries the row's stored `sizes`.
          const current = withoutStoredSizes(stored);
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
        }
      );

      if (!updatedRow) {
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

      // The row has changed, so a page cached with it is stale: invalidate once
      // the change is durable, which inside an enclosing SQLite transaction
      // means once that commits.
      await this.afterCommit(() => revalidateMedia([mediaId], this.logger));

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
      this.logger.error("[MediaService] Update media error", { error: error });
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

      // The image sizes an item stored before they were removed are in the
      // retired `sizes` column, which the Drizzle definition no longer names.
      // Read here, before the delete's transaction, while the database still
      // has the column, so the delete removes those files too. Nothing writes
      // sizes any more, so this read cannot go stale in a way that keeps a
      // file: a run of `nextly media remove-sizes` meanwhile only removes
      // files this delete would have removed.
      const retiredSizes = await storedSizesOf(this.db, this.dialect, [
        mediaId,
      ]);

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
      const deletedRow = await this.adapter.transaction<StoredMediaRow | null>(
        async tx => {
          const current = await this.lockedRow(tx, mediaId);
          // Lost a delete race: the row is already gone, so record nothing.
          // Only the request that actually removes the row emits media.deleted.
          if (!current) {
            return null;
          }

          await tx.delete("media", this.whereEq("id", mediaId));

          // The removed row's final state ships as `data`, without its stored
          // `sizes`; there is no post-delete state, so `previous` is null
          // (mirroring create). Media has no field schema, so `fields` is
          // empty (nothing to strip).
          recorded = await recordMutationEvent(tx, {
            type: "media.deleted",
            resource: { kind: "media", id: mediaId },
            data: withoutStoredSizes(current),
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
      const mediaData: StoredMediaRow = {
        ...deletedRow,
        sizes: retiredSizes.get(mediaId) ?? null,
      };

      // Invalidated here, not after the cleanup below. The row is already gone,
      // so a cached page is already wrong; deferring past storage deletes and
      // their retry backoffs leaves it wrong for as long as that takes, and a
      // storage call that hangs until the request is killed would leave it
      // wrong permanently despite a committed delete. Inside an enclosing
      // SQLite transaction the delete is durable only once that commits.
      await this.afterCommit(() => revalidateMedia([mediaId], this.logger));

      // Best-effort physical cleanup AFTER the row + event have committed:
      // a storage failure must not fail a delete whose authoritative row
      // removal already succeeded. Read from the row as stored, so an item
      // that still has image sizes from before they were removed loses those
      // files too. Every stored file is removed on its own,
      // so one that fails leaves the others to go, and is named in the log
      // with its item, so the leftover can be found.
      //
      // Once the delete is durable: inside an enclosing SQLite transaction
      // this delete is a savepoint of it, and a rollback would bring the row
      // back pointing at files already gone.
      await this.afterCommit(async () => {
        // Every file except those another item still refers to, asked now
        // that this delete has committed; none when that cannot be asked.
        const kept = await filesKeptByOthers(
          this.storedFileSearch,
          storedFilesOf(mediaData).paths,
          [mediaId]
        );
        if (kept)
          await removeStoredFiles(this.storage, mediaData, mediaId, kept);
      });

      // The delete committed a media.deleted outbox row; drain and prune it
      // (no-op when the unified media service wraps this one and drains itself).
      await this.afterWrite(recorded);

      return {
        success: true,
        statusCode: 200,
        message: "Media deleted successfully",
      };
    } catch (error) {
      this.logger.error("[MediaService] Delete media error", {
        error: errorForLog(error),
      });
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
