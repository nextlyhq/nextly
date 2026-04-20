/**
 * Media API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * media management endpoints at /api/media.
 *
 * **IMPORTANT:** For storage plugins (S3, Vercel Blob, etc.) to work, you must
 * initialize Nextly with your config before these routes are called. The recommended
 * approach is to use Next.js instrumentation:
 *
 * ```typescript
 * // src/instrumentation.ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === "nodejs") {
 *     const { getNextly } = await import("@revnixhq/nextly");
 *     const nextlyConfig = (await import("./nextly.config")).default;
 *     await getNextly({ config: nextlyConfig });
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/media/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/media';
 *
 * // In your Next.js app: app/api/media/[id]/route.ts
 * export { getMediaById as GET, updateMedia as PATCH, deleteMedia as DELETE } from '@revnixhq/nextly/api/media';
 * ```
 *
 * @module api/media
 */

import { getService } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type {
  MediaService,
  ListMediaOptions,
} from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { UploadMediaInputSchema, UpdateMediaInputSchema } from "../types/media";

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the MediaService from the DI container.
 *
 * Uses getNextly() to ensure services are initialized. If Nextly was
 * pre-initialized via instrumentation.ts with config (including storage plugins),
 * this will use that cached instance. Otherwise, it will auto-initialize
 * with default settings (local storage).
 */
async function getMediaService(): Promise<MediaService> {
  // getNextly() returns cached instance if already initialized with config,
  // or auto-initializes with defaults if not
  await getNextly();
  return getService("mediaService");
}

/**
 * Create a success response in the legacy format
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
 * Create an error response in the legacy format
 */
function errorResponse(
  message: string,
  statusCode: number = 500,
  data: unknown = null
): Response {
  return Response.json(
    {
      success: false,
      statusCode,
      message,
      data,
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
  console.error(`[Media API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(
      error.message,
      error.httpStatus,
      error.details ?? null
    );
  }

  if (error instanceof Error) {
    // Check for service initialization errors
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503);
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

/**
 * Create a request context from the request.
 * Returns an empty context for unauthenticated requests.
 * In production, this would extract user info from auth headers/cookies.
 */
function createRequestContext(): RequestContext {
  // TODO: In a real implementation, extract user from auth headers
  // and populate email, role, permissions from your auth system
  return {};
}

/**
 * Create a request context with user info for authenticated operations
 */
function createAuthenticatedContext(userId: string): RequestContext {
  // For API routes that receive userId directly (like upload),
  // we create a minimal authenticated context.
  // In production, you would look up the full user details.
  return {
    user: {
      id: userId,
      email: `${userId}@api.local`, // Placeholder - should come from auth
      role: "user",
      permissions: [],
    },
  };
}

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET handler for listing media with pagination, search, and filters.
 *
 * Query Parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 24)
 * - search: Search query for filename, altText
 * - type: Filter by media type (image, video, audio, document, other)
 * - sortBy: Sort field (uploadedAt, filename, size)
 * - sortOrder: Sort direction (asc, desc)
 *
 * Response Codes:
 * - 200 OK: Media list retrieved successfully
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch media
 *
 * @param request - Next.js Request object
 * @returns Response with JSON media list
 *
 * @example
 * ```bash
 * curl "http://localhost:3000/api/media?page=1&pageSize=24&type=image"
 * # => {"success":true,"data":[...],"meta":{...}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const { searchParams } = new URL(request.url);
    const context = createRequestContext();

    // Parse query parameters
    const folderIdParam = searchParams.get("folderId");
    const options: ListMediaOptions = {
      page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : 24,
      search: searchParams.get("search") || undefined,
      type: (searchParams.get("type") as ListMediaOptions["type"]) || undefined,
      folderId: folderIdParam === "root" ? "root" : folderIdParam || undefined,
      sortBy:
        (searchParams.get("sortBy") as ListMediaOptions["sortBy"]) ||
        "uploadedAt",
      sortOrder:
        (searchParams.get("sortOrder") as ListMediaOptions["sortOrder"]) ||
        "desc",
    };

    const result = await mediaService.listMedia(options, context);

    // Transform to legacy response format
    return withTimezoneFormatting(
      successResponse(result.data, 200, {
        total: result.pagination.total,
        page: options.page,
        pageSize: options.pageSize,
        totalPages: Math.ceil(
          result.pagination.total / (options.pageSize ?? 24)
        ),
      })
    );
  } catch (error) {
    return handleError(error, "List media");
  }
}

/**
 * POST handler for uploading media files.
 *
 * Accepts multipart/form-data with a 'file' field and metadata.
 * Automatically processes images (thumbnails, dimensions).
 *
 * Form Data:
 * - file: File to upload (required)
 * - uploadedBy: User ID (required)
 *
 * Response Codes:
 * - 201 Created: Media uploaded successfully
 * - 400 Bad Request: Invalid input or missing file
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Upload failed
 *
 * @param request - Next.js Request object with FormData
 * @returns Response with JSON uploaded media object
 *
 * @example
 * ```typescript
 * const formData = new FormData();
 * formData.append('file', file);
 * formData.append('uploadedBy', userId);
 * const response = await fetch('/api/media', {
 *   method: 'POST',
 *   body: formData,
 * });
 * const { data: media } = await response.json();
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const uploadedBy = formData.get("uploadedBy") as string | null;
    const folderId = formData.get("folderId") as string | null;

    if (!file) {
      return errorResponse("File is required", 400);
    }

    if (!uploadedBy) {
      return errorResponse("uploadedBy is required", 400);
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate input using existing schema
    const input = {
      file: buffer,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      uploadedBy,
    };

    const validation = UploadMediaInputSchema.safeParse(input);
    if (!validation.success) {
      return errorResponse(
        validation.error.issues[0]?.message || "Invalid input",
        400
      );
    }

    // Create request context with user info
    const context = createAuthenticatedContext(uploadedBy);

    // Call new service
    const mediaFile = await mediaService.upload(
      {
        buffer,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        folderId: folderId || undefined,
      },
      context
    );

    return withTimezoneFormatting(successResponse(mediaFile, 201));
  } catch (error) {
    return handleError(error, "Upload media");
  }
}

/**
 * GET handler for fetching a single media item by ID.
 *
 * Response Codes:
 * - 200 OK: Media retrieved successfully
 * - 404 Not Found: Media not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to retrieve media
 *
 * @param request - Next.js Request object (unused)
 * @param params - Route params containing media ID
 * @returns Response with JSON media object
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/media/123
 * # => {"success":true,"data":{...}}
 * ```
 */
export async function getMediaById(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const resolvedParams = await params;
    const context = createRequestContext();

    const mediaFile = await mediaService.findById(resolvedParams.id, context);

    return withTimezoneFormatting(successResponse(mediaFile, 200));
  } catch (error) {
    return handleError(error, "Get media by ID");
  }
}

/**
 * PATCH handler for updating media metadata.
 *
 * Accepts JSON with metadata updates (altText, caption, tags).
 *
 * Request Body:
 * - altText: Optional alt text
 * - caption: Optional caption
 * - tags: Optional tags array
 *
 * Response Codes:
 * - 200 OK: Media updated successfully
 * - 400 Bad Request: Invalid input
 * - 404 Not Found: Media not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param params - Route params containing media ID
 * @returns Response with JSON updated media object
 *
 * @example
 * ```typescript
 * await fetch('/api/media/123', {
 *   method: 'PATCH',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     altText: 'Logo image',
 *     tags: ['branding', 'logo'],
 *   }),
 * });
 * ```
 */
export async function updateMedia(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const body = await request.json();

    // Validate input
    const validation = UpdateMediaInputSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(
        validation.error.issues[0]?.message || "Invalid input",
        400
      );
    }

    const resolvedParams = await params;
    const context = createRequestContext();

    const mediaFile = await mediaService.update(
      resolvedParams.id,
      validation.data,
      context
    );

    return withTimezoneFormatting(successResponse(mediaFile, 200));
  } catch (error) {
    return handleError(error, "Update media");
  }
}

/**
 * DELETE handler for deleting media files.
 *
 * Removes media from both storage and database.
 *
 * Response Codes:
 * - 200 OK: Media deleted successfully
 * - 404 Not Found: Media not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object (unused)
 * @param params - Route params containing media ID
 * @returns Response with JSON success message
 *
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/media/123
 * # => {"success":true,"message":"Media deleted successfully"}
 * ```
 */
export async function deleteMedia(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const resolvedParams = await params;
    const context = createRequestContext();

    await mediaService.delete(resolvedParams.id, context);

    return Response.json(
      {
        success: true,
        statusCode: 200,
        message: "Media deleted successfully",
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Delete media");
  }
}

/**
 * PATCH handler for moving media to a folder
 *
 * Path: /api/media/[id]/move
 * Body: { folderId: string | null }
 *
 * Response Codes:
 * - 200 OK: Media moved successfully
 * - 404 Not Found: Media or folder not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Move failed
 *
 * @param request - Next.js Request object
 * @param params - Route parameters
 * @returns Response with success message
 */
export async function moveMediaToFolder(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const resolvedParams = await params;
    const body = await request.json();
    const { folderId } = body;
    const context = createRequestContext();

    await mediaService.moveToFolder(resolvedParams.id, folderId, context);

    return Response.json(
      {
        success: true,
        statusCode: 200,
        message: "Media moved successfully",
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Move media to folder");
  }
}
