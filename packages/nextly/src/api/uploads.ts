/**
 * Upload API Route Handlers for Next.js
 *
 * These route handlers provide collection-specific upload endpoints for the
 * Nextly admin panel. They can be re-exported in your Next.js application
 * to provide file upload functionality at /admin/api/collections/[slug]/uploads.
 *
 * Unlike the global Media API (/api/media), these endpoints are designed for
 * collection upload fields where files belong to specific collections.
 *
 * **IMPORTANT:** For storage plugins to work, initialize Nextly with your config
 * via instrumentation.ts before these routes are called.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/admin/api/collections/[slug]/uploads/route.ts
 * export { POST, GET as LIST } from '@revnixhq/nextly/api/uploads';
 *
 * // In your Next.js app: app/admin/api/collections/[slug]/uploads/[id]/route.ts
 * export { GET, DELETE } from '@revnixhq/nextly/api/uploads';
 * ```
 *
 * Endpoints:
 * - POST /admin/api/collections/[slug]/uploads - Upload file to collection
 * - GET /admin/api/collections/[slug]/uploads - List uploads for collection
 * - GET /admin/api/collections/[slug]/uploads/[id] - Get upload metadata
 * - DELETE /admin/api/collections/[slug]/uploads/[id] - Delete upload
 *
 * @module api/uploads
 */

import { isServicesRegistered, getService } from "../di/register";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import {
  UploadService,
  type UploadConfig,
  type UploadServiceResult,
} from "../services/upload-service";
import { getMediaStorage } from "../storage/storage";

// ============================================================
// Types
// ============================================================

/**
 * Route params for upload endpoints
 */
interface UploadRouteParams {
  slug: string;
  id?: string;
}

/**
 * Collection upload configuration
 * Can be extended per-collection in the future
 */
interface CollectionUploadConfig extends UploadConfig {
  collectionSlug: string;
}

// ============================================================
// Singleton Upload Service
// ============================================================

let uploadServiceInstance: UploadService | null = null;

/**
 * Get or create the UploadService for a collection.
 * Uses the storage adapter from the initialized MediaStorage.
 *
 * Reads `security.uploads` from the Nextly config to apply
 * `additionalMimeTypes`, `allowedMimeTypes`, and `svgCsp` settings.
 *
 * Server-side validation provides reasonable defaults to prevent abuse.
 * Client-side validation enforces field-specific constraints (maxFileSize, mimeTypes).
 */
async function getUploadService(
  _collectionSlug: string,
  config?: Partial<UploadConfig>
): Promise<UploadService> {
  // Get the storage adapter - this will use the one configured via getNextly()
  const storage = getMediaStorage().getAdapter();

  // Read security.uploads config from the DI container (set during init)
  let uploadSecurityConfig:
    | {
        additionalMimeTypes?: string[];
        allowedMimeTypes?: string[];
        svgCsp?: boolean;
      }
    | undefined;
  if (isServicesRegistered()) {
    const serviceConfig = getService("config");
    uploadSecurityConfig = serviceConfig.security?.uploads;
  }

  return new UploadService(storage, {
    // Pass through config — UploadService applies secure defaults
    maxSize: config?.maxSize,
    // security.uploads.allowedMimeTypes overrides the default entirely
    allowedMimeTypes:
      config?.allowedMimeTypes ?? uploadSecurityConfig?.allowedMimeTypes,
    // security.uploads.additionalMimeTypes merges with defaults
    additionalMimeTypes:
      config?.additionalMimeTypes ?? uploadSecurityConfig?.additionalMimeTypes,
    // security.uploads.svgCsp controls SVG Content-Disposition: attachment
    svgCsp: uploadSecurityConfig?.svgCsp,
    generateThumbnails: config?.generateThumbnails,
    thumbnailSize: config?.thumbnailSize,
  });
}

/**
 * Reset the upload service singleton (for testing)
 */
export function resetUploadService(): void {
  uploadServiceInstance = null;
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
function successResponse<T>(
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>
): Response {
  return Response.json(
    {
      success: true,
      statusCode,
      data,
      ...(meta && { meta }),
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
  console.error(`[Upload API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, [
      { message: error.message },
    ]);
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
 * Extract route params from Next.js context
 */
async function extractParams(
  params: Promise<{ slug?: string; id?: string }>
): Promise<UploadRouteParams> {
  const resolved = await params;
  return {
    slug: resolved.slug || "",
    id: resolved.id,
  };
}

/**
 * Validate that a collection slug is provided
 */
function validateSlug(slug: string): Response | null {
  if (!slug) {
    return errorResponse("Collection slug is required", 400);
  }
  return null;
}

// ============================================================
// Route Handlers
// ============================================================

/**
 * POST handler for uploading files to a collection.
 *
 * Path: /admin/api/collections/[slug]/uploads
 *
 * Accepts multipart/form-data with:
 * - file: File to upload (required)
 * - _payload: JSON string with additional data (optional)
 *
 * Response Codes:
 * - 201 Created: File uploaded successfully
 * - 400 Bad Request: Invalid input or missing file
 * - 401 Unauthorized: Not authenticated
 * - 500 Internal Server Error: Upload failed
 *
 * @param request - Next.js Request object with FormData
 * @param context - Route context with params
 * @returns Response with JSON upload result
 *
 * @example
 * ```typescript
 * const formData = new FormData();
 * formData.append('file', selectedFile);
 * formData.append('_payload', JSON.stringify({ alt: 'Description' }));
 *
 * const response = await fetch('/admin/api/collections/media/uploads', {
 *   method: 'POST',
 *   body: formData,
 *   credentials: 'include',
 * });
 * const { data } = await response.json();
 * ```
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug?: string }> }
): Promise<Response> {
  try {
    await ensureServicesInitialized();

    const { slug } = await extractParams(params);
    const slugError = validateSlug(slug);
    if (slugError) return slugError;

    // Parse FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return errorResponse("File is required", 400, [
        { field: "file", message: "No file provided" },
      ]);
    }

    // Parse additional data from _payload field
    const payloadStr = formData.get("_payload") as string | null;
    let additionalData: Record<string, unknown> = {};
    if (payloadStr) {
      try {
        additionalData = JSON.parse(payloadStr);
      } catch {
        // Ignore invalid JSON in _payload
      }
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Get upload service and upload file
    const uploadService = await getUploadService(slug);
    const result = await uploadService.upload(buffer, {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      collectionSlug: slug,
    });

    if (!result.success) {
      return errorResponse(
        result.message || "Upload failed",
        result.statusCode,
        result.errors
      );
    }

    // Transform to client-expected format
    const uploadData = {
      id: result.data?.id,
      filename: result.data?.filename,
      mimeType: result.data?.mimeType,
      filesize: result.data?.size,
      url: result.data?.url,
      thumbnailUrl: result.data?.thumbnailUrl,
      width: result.data?.width,
      height: result.data?.height,
      createdAt: new Date().toISOString(),
      ...additionalData,
    };

    return withTimezoneFormatting(successResponse(uploadData, 201));
  } catch (error) {
    return handleError(error, "Upload file");
  }
}

/**
 * GET handler for retrieving upload metadata by ID.
 *
 * Path: /admin/api/collections/[slug]/uploads/[id]
 *
 * Response Codes:
 * - 200 OK: Metadata retrieved successfully
 * - 400 Bad Request: Missing collection slug or upload ID
 * - 404 Not Found: Upload not found
 * - 500 Internal Server Error: Failed to get metadata
 *
 * @param request - Next.js Request object
 * @param context - Route context with params
 * @returns Response with JSON upload metadata
 *
 * @example
 * ```bash
 * curl http://localhost:3000/admin/api/collections/media/uploads/abc-123
 * # => {"success":true,"data":{...}}
 * ```
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug?: string; id?: string }> }
): Promise<Response> {
  try {
    await ensureServicesInitialized();

    const { slug, id } = await extractParams(params);
    const slugError = validateSlug(slug);
    if (slugError) return slugError;

    // If no ID provided, this is a list request
    if (!id) {
      return handleList(request, slug);
    }

    // Get metadata for specific upload
    const uploadService = await getUploadService(slug);

    // The ID is the file path relative to the collection folder
    const filePath = `${slug}/${id}`;
    const result = await uploadService.getMetadata(filePath);

    if (!result.success) {
      return errorResponse(
        result.message || "Upload not found",
        result.statusCode
      );
    }

    // Transform to client-expected format
    const uploadData = {
      id: result.data?.id,
      filename: result.data?.filename || result.data?.originalFilename,
      mimeType: result.data?.mimeType,
      filesize: result.data?.size,
      url: result.data?.url,
      thumbnailUrl: result.data?.thumbnailUrl,
      width: result.data?.width,
      height: result.data?.height,
      createdAt: result.data?.createdAt,
      updatedAt: result.data?.updatedAt,
    };

    return withTimezoneFormatting(successResponse(uploadData, 200));
  } catch (error) {
    return handleError(error, "Get upload metadata");
  }
}

/**
 * Handle list request for uploads in a collection.
 * This is called when GET is invoked without an ID.
 *
 * Note: Currently returns empty list as listing requires storage adapter
 * enumeration which may not be efficient for all storage backends.
 * In production, you would typically query a database for upload records.
 */
async function handleList(request: Request, slug: string): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  // For now, return empty list
  // In production, this would query a database or enumerate storage
  return withTimezoneFormatting(
    successResponse([], 200, {
      page,
      limit,
      total: 0,
      totalPages: 0,
    })
  );
}

/**
 * DELETE handler for removing an upload.
 *
 * Path: /admin/api/collections/[slug]/uploads/[id]
 *
 * Response Codes:
 * - 200 OK: Upload deleted successfully
 * - 400 Bad Request: Missing collection slug or upload ID
 * - 404 Not Found: Upload not found
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params
 * @returns Response with success message
 *
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/admin/api/collections/media/uploads/abc-123
 * # => {"success":true,"message":"Upload deleted successfully"}
 * ```
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug?: string; id?: string }> }
): Promise<Response> {
  try {
    await ensureServicesInitialized();

    const { slug, id } = await extractParams(params);
    const slugError = validateSlug(slug);
    if (slugError) return slugError;

    if (!id) {
      return errorResponse("Upload ID is required", 400, [
        { field: "id", message: "No upload ID provided" },
      ]);
    }

    const uploadService = await getUploadService(slug);

    // The ID is the file path relative to the collection folder
    const filePath = `${slug}/${id}`;
    const result = await uploadService.delete(filePath);

    if (!result.success) {
      return errorResponse(
        result.message || "Failed to delete upload",
        result.statusCode
      );
    }

    return Response.json(
      {
        success: true,
        statusCode: 200,
        message: "Upload deleted successfully",
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Delete upload");
  }
}

/**
 * Alias for GET when used for listing (semantic export)
 */
export const LIST = GET;
