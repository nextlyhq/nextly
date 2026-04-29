/**
 * Bulk Media API Route Handlers for Next.js
 *
 * These route handlers provide bulk operations for media management.
 * Supports bulk upload and bulk delete with parallel processing.
 *
 * IMPORTANT: Before using these routes, you must initialize the service layer by calling
 * `registerServices()` during your application startup.
 *
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and
 * return the canonical `{ data: <result> }` envelope per spec §10.2. The
 * bulk-result payload (per-file `results`, counts, validationErrors) lives
 * inside `data`. Errors flow through the wrapper as
 * `application/problem+json`. The legacy "all-failed → status 500" branch
 * is dropped: per-file failures are normal data the caller iterates over,
 * not a server error.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/media/bulk/route.ts
 * export { POST, DELETE } from '@revnixhq/nextly/api/media-bulk';
 * ```
 *
 * @module api/media-bulk
 */

import { getService, isServicesRegistered } from "../di";
import { NextlyError } from "../errors/nextly-error";
import type { MediaService } from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { UploadMediaInputSchema } from "../types/media";

import { createSuccessResponse } from "./create-success-response";
import { readJsonBody } from "./read-json-body";
import { withErrorHandler } from "./with-error-handler";

function getMediaService(): MediaService {
  if (!isServicesRegistered()) {
    // Per F10 / Task 6: surface initialization failures via the canonical
    // 503 factory so the public response sticks to the §13.8-canonical
    // sentence emitted by `serviceUnavailable()`. The setup hint goes to
    // `logContext` so operators see it without leaking into the wire.
    throw NextlyError.serviceUnavailable({
      logMessage: "Media bulk handler called before registerServices()",
      logContext: {
        hint: "Call registerServices() before mounting media-bulk routes. See https://nextlyhq.com/docs/initialization",
      },
    });
  }
  return getService("mediaService");
}

/**
 * Build a request context with user info. Passing null produces a context
 * with no user — `media.uploaded_by` is nullable, so this is valid for
 * system-context uploads.
 */
function createAuthenticatedContext(userId: string | null): RequestContext {
  if (!userId) return {};
  return {
    user: {
      id: userId,
      email: `${userId}@api.local`,
      role: "user",
      permissions: [],
    },
  };
}

/**
 * POST handler for bulk media upload
 *
 * Uploads multiple files in parallel with a concurrency limit of 5.
 * Provides detailed results for each file (success/failure).
 *
 * Request Body (JSON):
 * {
 *   files: Array<{
 *     file: string (base64),
 *     filename: string,
 *     mimeType: string,
 *     size: number,
 *     uploadedBy: string
 *   }>,
 *   uploadedBy?: string,
 * }
 *
 * Response: `{ "data": { totalFiles, successCount, failureCount, results,
 * validationErrors } }`. Status 200 even when every file failed — per-file
 * outcomes are part of the payload, not server errors. If the request
 * itself is malformed (no files, all invalid), throws
 * `VALIDATION_ERROR` (400).
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    const mediaService = getMediaService();
    const body = await readJsonBody<Record<string, unknown>>(request);
    const filesInput = body.files;
    const uploadedBy =
      typeof body.uploadedBy === "string" ? body.uploadedBy : undefined;

    if (!Array.isArray(filesInput) || filesInput.length === 0) {
      throw NextlyError.validation({
        errors: [
          {
            path: "files",
            code: "required_array",
            message: "files must be a non-empty array.",
          },
        ],
      });
    }

    const validatedFiles: Array<{
      buffer: Buffer;
      filename: string;
      mimeType: string;
      size: number;
    }> = [];
    const validationErrors: Array<{
      index: number;
      filename: string;
      error: string;
    }> = [];

    for (let i = 0; i < filesInput.length; i++) {
      const file = filesInput[i] as Record<string, unknown>;

      let buffer: Buffer;
      if (typeof file.file === "string") {
        buffer = Buffer.from(file.file, "base64");
      } else if (Buffer.isBuffer(file.file)) {
        buffer = file.file;
      } else {
        validationErrors.push({
          index: i,
          filename: (file.filename as string) || `file-${i}`,
          error: "Invalid file format",
        });
        continue;
      }

      const parseResult = UploadMediaInputSchema.safeParse({
        file: buffer,
        filename: file.filename,
        mimeType: file.mimeType,
        size: (file.size as number) || buffer.length,
        uploadedBy: (file.uploadedBy as string) || uploadedBy,
      });

      if (!parseResult.success) {
        validationErrors.push({
          index: i,
          filename: (file.filename as string) || `file-${i}`,
          error: parseResult.error.issues[0]?.message || "Validation failed",
        });
      } else {
        validatedFiles.push({
          buffer,
          filename: file.filename as string,
          mimeType: file.mimeType as string,
          size: (file.size as number) || buffer.length,
        });
      }
    }

    if (validatedFiles.length === 0) {
      // Every entry failed validation. Surface as the canonical
      // VALIDATION_ERROR with per-file detail in `data.errors[]` so the
      // admin client can render inline messages keyed to `path`.
      throw NextlyError.validation({
        errors: validationErrors.map(v => ({
          path: `files[${v.index}]`,
          code: "INVALID_FILE",
          message: v.error,
        })),
        logContext: { totalFiles: filesInput.length },
      });
    }

    const firstFile = filesInput[0] as Record<string, unknown>;
    const userId = (firstFile.uploadedBy as string) || uploadedBy || null;
    const context = createAuthenticatedContext(userId);

    const result = await mediaService.bulkUpload(validatedFiles, context);

    return createSuccessResponse({
      totalFiles: result.totalItems,
      successCount: result.successCount,
      failureCount: result.failureCount,
      results: result.results,
      validationErrors,
    });
  }
);

/**
 * DELETE handler for bulk media deletion
 *
 * Deletes multiple media files in parallel with a concurrency limit of 10.
 *
 * Request Body (JSON):
 * {
 *   mediaIds: string[]
 * }
 *
 * Response: `{ "data": { totalFiles, successCount, failureCount,
 * results } }`. Status 200 regardless of per-file outcomes (see POST note).
 */
export const DELETE = withErrorHandler(
  async (request: Request): Promise<Response> => {
    const mediaService = getMediaService();
    const body = await readJsonBody<Record<string, unknown>>(request);
    const mediaIds = body.mediaIds;

    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
      throw NextlyError.validation({
        errors: [
          {
            path: "mediaIds",
            code: "required_array",
            message: "mediaIds must be a non-empty array.",
          },
        ],
      });
    }

    const context: RequestContext = {};
    const result = await mediaService.bulkDelete(mediaIds as string[], context);

    return createSuccessResponse({
      totalFiles: result.totalItems,
      successCount: result.successCount,
      failureCount: result.failureCount,
      results: result.results,
    });
  }
);
