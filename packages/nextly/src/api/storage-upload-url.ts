/**
 * Storage Upload URL API Route Handler
 *
 * Provides an endpoint for generating pre-signed URLs for client-side uploads.
 * This allows direct-to-storage uploads that bypass serverless platform limits
 * (e.g., Vercel's 4.5MB request body limit).
 *
 * Only available when:
 * 1. A storage plugin (S3, etc.) is configured for the collection
 * 2. The collection has `clientUploads: true` in its config
 * 3. The storage adapter supports pre-signed upload URLs
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/nextly/storage/upload-url/route.ts
 * export { POST } from '@revnixhq/nextly/api/storage-upload-url';
 * ```
 *
 * Client usage:
 * ```typescript
 * // 1. Get pre-signed upload URL from server
 * const response = await fetch('/api/nextly/storage/upload-url', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     filename: 'photo.jpg',
 *     mimeType: 'image/jpeg',
 *     collection: 'media'
 *   })
 * });
 * const { data } = await response.json();
 *
 * // 2. Upload directly to storage using pre-signed URL
 * await fetch(data.uploadUrl, {
 *   method: data.method,
 *   headers: data.headers,
 *   body: file
 * });
 * ```
 *
 * @module api/storage-upload-url
 */

import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { getMediaStorage } from "../storage/storage";
import type { ClientUploadData } from "../storage/types";

// ============================================================
// Types
// ============================================================

/**
 * Request body for upload URL generation
 */
interface UploadUrlRequest {
  /** Original filename */
  filename: string;
  /** File MIME type (e.g., 'image/jpeg', 'application/pdf') */
  mimeType: string;
  /** Collection slug to upload to */
  collection: string;
  /** Optional: Custom URL expiry time in seconds */
  expiresIn?: number;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Ensure services are initialized.
 * Uses getNextly() which returns the cached instance with config if available.
 */
async function ensureServicesInitialized(): Promise<void> {
  await getNextly();
}

/**
 * Create a success response
 */
function successResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json(
    {
      success: true,
      statusCode,
      data,
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Create an error response
 */
function errorResponse(
  message: string,
  statusCode: number = 500,
  errors?: Array<{ field?: string; message: string }>
): Response {
  return Response.json(
    {
      success: false,
      statusCode,
      message,
      ...(errors && { errors }),
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Handle errors from service layer
 */
function handleError(error: unknown, operation: string): Response {
  console.error(`[Storage Upload URL API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, [
      { message: error.message },
    ]);
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503);
    }
    if (error.message.includes("handleUpload")) {
      // Vercel Blob doesn't support pre-signed URLs
      return errorResponse(
        "This storage provider does not support pre-signed upload URLs. " +
          "Use the standard upload endpoint instead.",
        400,
        [{ message: error.message }]
      );
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

/**
 * Validate request body
 */
function validateRequest(
  body: Partial<UploadUrlRequest>
): { valid: true; data: UploadUrlRequest } | { valid: false; error: Response } {
  const errors: Array<{ field: string; message: string }> = [];

  if (!body.filename || typeof body.filename !== "string") {
    errors.push({ field: "filename", message: "filename is required" });
  }

  if (!body.mimeType || typeof body.mimeType !== "string") {
    errors.push({ field: "mimeType", message: "mimeType is required" });
  }

  if (!body.collection || typeof body.collection !== "string") {
    errors.push({ field: "collection", message: "collection is required" });
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: errorResponse("Invalid request body", 400, errors),
    };
  }

  return {
    valid: true,
    data: body as UploadUrlRequest,
  };
}

// ============================================================
// Route Handler
// ============================================================

/**
 * POST handler for generating client upload URLs.
 *
 * Path: /api/nextly/storage/upload-url
 *
 * Request Body (JSON):
 * - filename: string - Original filename
 * - mimeType: string - File MIME type
 * - collection: string - Collection slug
 * - expiresIn?: number - Optional URL expiry in seconds
 *
 * Response Codes:
 * - 200 OK: Upload URL generated successfully
 * - 400 Bad Request: Invalid input or client uploads not enabled
 * - 500 Internal Server Error: URL generation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with ClientUploadData or error
 *
 * @example Success Response
 * ```json
 * {
 *   "success": true,
 *   "statusCode": 200,
 *   "data": {
 *     "uploadUrl": "https://bucket.s3.region.amazonaws.com/...",
 *     "path": "2026/01/uuid-filename.jpg",
 *     "method": "PUT",
 *     "headers": { "Content-Type": "image/jpeg" },
 *     "expiresAt": "2026-01-13T12:00:00.000Z"
 *   }
 * }
 * ```
 *
 * @example Error Response (client uploads not enabled)
 * ```json
 * {
 *   "success": false,
 *   "statusCode": 400,
 *   "message": "Client uploads not enabled for this collection"
 * }
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await ensureServicesInitialized();

    // Parse JSON body
    let body: Partial<UploadUrlRequest>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    // Validate request
    const validation = validateRequest(body);
    if (!validation.valid) {
      return validation.error;
    }

    const { filename, mimeType, collection } = validation.data;

    // Get MediaStorage instance
    const storage = getMediaStorage();

    // Check if client uploads are supported for this collection
    if (!storage.supportsClientUploads(collection)) {
      // Provide helpful error message based on why it's not supported
      const config = storage.getCollectionConfig(collection);
      const adapter = storage.getAdapterForCollection(collection);
      const adapterInfo = adapter.getInfo?.();

      if (!config) {
        return errorResponse(
          `Collection '${collection}' is not configured with a storage plugin. ` +
            "Configure a storage plugin (e.g., S3) with this collection to enable client uploads.",
          400,
          [{ field: "collection", message: "No storage plugin configured" }]
        );
      }

      if (!config.clientUploads) {
        return errorResponse(
          `Client uploads are not enabled for collection '${collection}'. ` +
            "Add 'clientUploads: true' to the collection's storage configuration.",
          400,
          [{ field: "collection", message: "clientUploads not enabled" }]
        );
      }

      if (!adapterInfo?.supportsClientUploads) {
        return errorResponse(
          `The storage adapter for collection '${collection}' does not support client uploads. ` +
            `Storage type: ${adapterInfo?.type || "unknown"}`,
          400,
          [
            {
              field: "collection",
              message: "Adapter does not support client uploads",
            },
          ]
        );
      }

      // Fallback error
      return errorResponse(
        "Client uploads not enabled for this collection",
        400
      );
    }

    // Generate client upload URL
    const uploadData: ClientUploadData | null =
      await storage.getClientUploadUrl(filename, mimeType, collection);

    if (!uploadData) {
      return errorResponse(
        "Failed to generate upload URL. The storage plugin may not support client uploads.",
        500
      );
    }

    return successResponse(uploadData, 200);
  } catch (error) {
    return handleError(error, "Generate upload URL");
  }
}
