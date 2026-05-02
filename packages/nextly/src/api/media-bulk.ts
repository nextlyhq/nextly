/**
 * Bulk Media API Route Handlers for Next.js
 *
 * These route handlers provide bulk operations for media management.
 * Supports bulk upload and bulk delete with parallel processing.
 *
 * IMPORTANT: Before using these routes, you must initialize the service layer by calling
 * `registerServices()` during your application startup.
 *
 * Wire shape (Phase 4.5 migration):
 *   - DELETE returns the canonical respondBulk envelope:
 *     `{ message, items, errors }` where items are minimal `{id}` records
 *     for deleted files and errors are id-keyed PerItemError entries.
 *   - POST returns the canonical respondBulkUpload envelope:
 *     `{ message, items, errors }` where items are full MediaFile records
 *     for newly-uploaded files and errors are positional BulkUploadError
 *     entries (`{ index, filename, code, message }`).
 *
 * Per-item failures are first-class data in the body's `errors` array
 * (HTTP 200). 4xx is reserved for malformed requests (e.g. empty input,
 * all entries failed input validation before the service was reached).
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

import { readJsonBody } from "./read-json-body";
import {
  respondBulk,
  respondBulkUpload,
  type BulkUploadError,
} from "./response-shapes";
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
 * POST handler for bulk media upload.
 *
 * Uploads multiple files. Provides detailed per-file results, positional
 * (index + filename) for failures since uploads have no client-supplied id.
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
 * Response: canonical respondBulkUpload envelope `{ message, items, errors }`.
 * Items are full MediaFile records for newly-uploaded files; errors are
 * positional BulkUploadError entries. Pre-upload validation failures fold
 * into the same `errors` array (no parallel `validationErrors` field;
 * unified failure list per Phase 4.5 D3). Status 200 for partial-success.
 *
 * 4xx applies only to fully-malformed requests: empty `files` array, or
 * every entry failed input validation (no useful service work to do).
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

    // Validated input + the original index it occupied in `filesInput`.
    // We carry the original index so post-upload failure entries report
    // the slot the caller submitted, not the slot in `validatedFiles`.
    const validatedFiles: Array<{
      buffer: Buffer;
      filename: string;
      mimeType: string;
      size: number;
      originalIndex: number;
    }> = [];
    // Phase 4.5: pre-upload validation failures fold into the same
    // failures list as upload failures from the service. One unified
    // `errors[]` on the wire keeps the consumer iteration simple and
    // honest (a failed file is a failed file, regardless of where in
    // the pipeline it failed).
    const failures: BulkUploadError[] = [];

    for (let i = 0; i < filesInput.length; i++) {
      const file = filesInput[i] as Record<string, unknown>;
      const filename = (file.filename as string) || `file-${i}`;

      let buffer: Buffer;
      if (typeof file.file === "string") {
        buffer = Buffer.from(file.file, "base64");
      } else if (Buffer.isBuffer(file.file)) {
        buffer = file.file;
      } else {
        // Generic public message per spec section 13.8. The actual
        // discriminator (string | Buffer) goes to the operator log via
        // logContext below if anyone wires it up later. The wire stays
        // generic.
        failures.push({
          index: i,
          filename,
          code: "VALIDATION_ERROR",
          message: "Invalid file format.",
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
        failures.push({
          index: i,
          filename,
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
        });
      } else {
        validatedFiles.push({
          buffer,
          filename: file.filename as string,
          mimeType: file.mimeType as string,
          size: (file.size as number) || buffer.length,
          originalIndex: i,
        });
      }
    }

    if (validatedFiles.length === 0) {
      // Every entry failed input validation. No service work would
      // succeed; raise a request-level 400 with per-file detail so the
      // admin client can render inline messages.
      throw NextlyError.validation({
        errors: failures.map(f => ({
          path: `files[${f.index}]`,
          code: "INVALID_FILE",
          message: f.message,
        })),
        logContext: { totalFiles: filesInput.length },
      });
    }

    const firstFile = filesInput[0] as Record<string, unknown>;
    const userId = (firstFile.uploadedBy as string) || uploadedBy || null;
    const context = createAuthenticatedContext(userId);

    // Strip originalIndex before handing to the service. The service
    // doesn't need it, but we use it below to remap service failures
    // (which are 0-indexed in validatedFiles) back to the caller's
    // original payload indices.
    const serviceInputs = validatedFiles.map(({ originalIndex: _, ...rest }) => rest);
    const result = await mediaService.bulkUpload(serviceInputs, context);

    // Remap service-side failure indices back to the caller's original
    // payload indices so all `errors[].index` values address the same
    // input array.
    for (const f of result.failures) {
      const original = validatedFiles[f.index];
      failures.push({
        index: original?.originalIndex ?? f.index,
        filename: f.filename,
        code: f.code,
        message: f.message,
      });
    }

    const totalRequested = filesInput.length;
    const successCount = result.successCount;
    const message =
      failures.length === 0
        ? `Uploaded ${successCount} ${
            successCount === 1 ? "file" : "files"
          }.`
        : `Uploaded ${successCount} of ${totalRequested} files.`;

    return respondBulkUpload(message, result.successes, failures);
  }
);

/**
 * DELETE handler for bulk media deletion.
 *
 * Response: canonical respondBulk envelope `{ message, items, errors }`.
 * Items are minimal `{id}` records (the files are gone); errors are
 * id-keyed PerItemError entries. Status 200 for partial-success; 400
 * only for an empty/malformed `mediaIds` array.
 *
 * Request Body (JSON):
 * {
 *   mediaIds: string[]
 * }
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

    const message =
      result.failures.length === 0
        ? `Deleted ${result.successCount} ${
            result.successCount === 1 ? "file" : "files"
          }.`
        : `Deleted ${result.successCount} of ${result.total} files.`;

    return respondBulk(message, result.successes, result.failures);
  }
);
