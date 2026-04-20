/**
 * Bulk Media API Route Handlers for Next.js
 *
 * These route handlers provide bulk operations for media management.
 * Supports bulk upload and bulk delete with parallel processing.
 *
 * IMPORTANT: Before using these routes, you must initialize the service layer by calling
 * `registerServices()` during your application startup.
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
import { isServiceError } from "../errors";
import type { MediaService } from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { UploadMediaInputSchema } from "../types/media";

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the MediaService from the DI container.
 * Throws an error if services haven't been registered.
 */
function getMediaService(): MediaService {
  if (!isServicesRegistered()) {
    throw new Error(
      "Services not initialized. Call registerServices() before using API routes. " +
        "See https://nextlyhq.com/docs/initialization for setup instructions."
    );
  }
  return getService("mediaService");
}

/**
 * Create an error response in the legacy format
 */
function errorResponse(
  message: string,
  statusCode: number = 500,
  extra?: Record<string, unknown>
): Response {
  return Response.json(
    {
      success: false,
      statusCode,
      message,
      ...extra,
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Handle errors from service layer and convert to legacy response format
 */
function handleError(error: unknown, operation: string): Response {
  console.error(`[Bulk Media API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus);
  }

  if (error instanceof Error) {
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503);
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

/**
 * Create a request context with user info for authenticated operations.
 * Passing null produces a context with no user — media.uploaded_by is
 * nullable, so this is valid for system-context uploads.
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

// ============================================================
// Route Handlers
// ============================================================

/**
 * POST handler for bulk media upload
 *
 * Uploads multiple files in parallel with a concurrency limit of 5.
 * Provides detailed results for each file (success/failure).
 *
 * Request Body (JSON):
 * {
 *   files: Array<{
 *     file: string (base64),  // Or send as multipart/form-data
 *     filename: string,
 *     mimeType: string,
 *     size: number,
 *     uploadedBy: string
 *   }>
 * }
 *
 * Response Codes:
 * - 200 OK: At least one file uploaded successfully
 * - 400 Bad Request: No files provided or validation error
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to process bulk upload
 *
 * @param request - Next.js Request object
 * @returns Response with JSON results
 *
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/media/bulk \
 *   -H "Content-Type: application/json" \
 *   -d '{"files":[...]}'
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const mediaService = getMediaService();
    const body = await request.json();
    const { files, uploadedBy } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return errorResponse("No files provided", 400);
    }

    // Validate each file and prepare upload inputs
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

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Convert base64 to Buffer if needed
      let buffer: Buffer;
      if (typeof file.file === "string") {
        // Assume base64
        buffer = Buffer.from(file.file, "base64");
      } else if (Buffer.isBuffer(file.file)) {
        buffer = file.file;
      } else {
        validationErrors.push({
          index: i,
          filename: file.filename || `file-${i}`,
          error: "Invalid file format",
        });
        continue;
      }

      const parseResult = UploadMediaInputSchema.safeParse({
        file: buffer,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size || buffer.length,
        uploadedBy: file.uploadedBy || uploadedBy,
      });

      if (!parseResult.success) {
        validationErrors.push({
          index: i,
          filename: file.filename || `file-${i}`,
          error: parseResult.error.issues[0]?.message || "Validation failed",
        });
      } else {
        validatedFiles.push({
          buffer,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.size || buffer.length,
        });
      }
    }

    if (validatedFiles.length === 0) {
      return errorResponse("No valid files to upload", 400, {
        validationErrors,
      });
    }

    // Get user ID for context (use first file's uploadedBy or body-level
    // uploadedBy). Null when neither is provided — MediaService will insert
    // media with uploaded_by = NULL, which the schema allows.
    const userId = files[0]?.uploadedBy || uploadedBy || null;
    const context = createAuthenticatedContext(userId);

    // Process bulk upload using new service
    const result = await mediaService.bulkUpload(validatedFiles, context);

    const success = result.successCount > 0;
    return Response.json(
      {
        success,
        statusCode: success ? 200 : 500,
        message: `Uploaded ${result.successCount} of ${result.totalItems} files`,
        totalFiles: result.totalItems,
        successCount: result.successCount,
        failureCount: result.failureCount,
        results: result.results,
        validationErrors,
      },
      {
        status: success ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Bulk upload");
  }
}

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
 * Response Codes:
 * - 200 OK: At least one file deleted successfully
 * - 400 Bad Request: No media IDs provided
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to process bulk delete
 *
 * @param request - Next.js Request object
 * @returns Response with JSON results
 *
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/media/bulk \
 *   -H "Content-Type: application/json" \
 *   -d '{"mediaIds":["id1","id2","id3"]}'
 * ```
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const mediaService = getMediaService();
    const body = await request.json();
    const { mediaIds } = body;

    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
      return errorResponse("No media IDs provided", 400);
    }

    // Create context (bulk delete typically doesn't need auth context for this operation)
    const context: RequestContext = {};

    // Process bulk delete using new service
    const result = await mediaService.bulkDelete(mediaIds, context);

    const success = result.successCount > 0;
    return Response.json(
      {
        success,
        statusCode: success ? 200 : 500,
        message: `Deleted ${result.successCount} of ${result.totalItems} files`,
        totalFiles: result.totalItems,
        successCount: result.successCount,
        failureCount: result.failureCount,
        results: result.results,
      },
      {
        status: success ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Bulk delete");
  }
}
