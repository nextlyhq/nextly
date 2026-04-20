/**
 * Media Folders API Route Handlers
 *
 * Next.js App Router compatible handlers for folder management operations.
 * Re-export these handlers in your app's API routes.
 *
 * **IMPORTANT:** For storage plugins to work, initialize Nextly with your config
 * via instrumentation.ts before these routes are called.
 *
 * @example
 * ```typescript
 * // app/api/media/folders/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/media-folders';
 *
 * // app/api/media/folders/[id]/route.ts
 * export { getFolderById as GET, updateFolder as PATCH, deleteFolder as DELETE } from '@revnixhq/nextly/api/media-folders';
 *
 * // app/api/media/folders/[id]/contents/route.ts
 * export { getFolderContents as GET } from '@revnixhq/nextly/api/media-folders';
 *
 * // app/api/media/folders/root/contents/route.ts
 * export { getRootFolderContents as GET } from '@revnixhq/nextly/api/media-folders';
 * ```
 */

import { NextRequest, NextResponse } from "next/server";

import { getService } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { MediaService } from "../services/media/media-service";
import type { RequestContext } from "../services/shared";

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the MediaService from the DI container.
 *
 * Uses getNextly() to ensure services are initialized with the cached
 * config (including storage plugins) if available.
 */
async function getMediaService(): Promise<MediaService> {
  await getNextly();
  return getService("mediaService");
}

/**
 * Create a success response in the legacy format
 */
function successResponse<T>(data: T, statusCode: number = 200): NextResponse {
  return NextResponse.json(
    {
      success: true,
      statusCode,
      data,
    },
    { status: statusCode }
  );
}

/**
 * Create an error response in the legacy format
 */
function errorResponse(
  message: string,
  statusCode: number = 500,
  error?: string
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      statusCode,
      message,
      ...(error && { error }),
    },
    { status: statusCode }
  );
}

/**
 * Handle errors from service layer and convert to legacy response format
 */
function handleError(error: unknown, operation: string): NextResponse {
  console.error(`[Media Folders API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus);
  }

  if (error instanceof Error) {
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503);
    }
    return errorResponse(
      "Failed to " + operation.toLowerCase(),
      500,
      error.message
    );
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

/**
 * Create a request context from the request.
 * Returns an empty context for unauthenticated requests.
 */
function createRequestContext(): RequestContext {
  return {};
}

/**
 * Create a request context with user info for authenticated operations
 */
function createAuthenticatedContext(userId: string): RequestContext {
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
 * GET /api/media/folders
 *
 * List folders with optional filtering:
 * - ?root=true - List only root folders (no parent)
 * - ?parentId=xxx - List subfolders of a specific parent
 *
 * Response Codes:
 * - 200 OK: Folders listed successfully
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to list folders
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const { searchParams } = new URL(request.url);
    const root = searchParams.get("root") === "true";
    const parentId = searchParams.get("parentId");

    let folders;

    if (root || !parentId) {
      // List root folders
      folders = await mediaService.listRootFolders(context);
    } else {
      // List subfolders of a specific parent
      folders = await mediaService.listSubfolders(parentId, context);
    }

    return successResponse(folders, 200);
  } catch (error) {
    return handleError(error, "List folders");
  }
}

/**
 * POST /api/media/folders
 *
 * Create a new folder
 *
 * Request Body:
 * - name: string (required)
 * - description?: string
 * - color?: string
 * - icon?: string
 * - parentId?: string | null
 * - createdBy: string (required)
 *
 * Response Codes:
 * - 201 Created: Folder created successfully
 * - 400 Bad Request: Invalid input
 * - 404 Not Found: Parent folder not found
 * - 409 Conflict: Folder with same name already exists
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to create folder
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const body = await request.json();

    // Extract createdBy for context, rest goes to service
    const { createdBy, ...folderInput } = body;

    if (!createdBy) {
      return errorResponse("createdBy is required", 400);
    }

    if (!folderInput.name) {
      return errorResponse("name is required", 400);
    }

    const context = createAuthenticatedContext(createdBy);
    const folder = await mediaService.createFolder(folderInput, context);

    return successResponse(folder, 201);
  } catch (error) {
    return handleError(error, "Create folder");
  }
}

/**
 * GET /api/media/folders/[id]
 *
 * Get folder by ID
 *
 * Response Codes:
 * - 200 OK: Folder retrieved successfully
 * - 404 Not Found: Folder not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to get folder
 */
export async function getFolderById(
  _request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const params = await routeContext.params;
    const context = createRequestContext();

    const folder = await mediaService.findFolderById(params.id, context);

    return successResponse(folder, 200);
  } catch (error) {
    return handleError(error, "Get folder");
  }
}

/**
 * PATCH /api/media/folders/[id]
 *
 * Update folder metadata
 *
 * Request Body:
 * - name?: string
 * - description?: string
 * - color?: string
 * - icon?: string
 * - parentId?: string | null
 *
 * Response Codes:
 * - 200 OK: Folder updated successfully
 * - 400 Bad Request: Invalid input (e.g., circular parent reference)
 * - 404 Not Found: Folder not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to update folder
 */
export async function updateFolder(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const params = await routeContext.params;
    const body = await request.json();
    const context = createRequestContext();

    const folder = await mediaService.updateFolder(params.id, body, context);

    return successResponse(folder, 200);
  } catch (error) {
    return handleError(error, "Update folder");
  }
}

/**
 * DELETE /api/media/folders/[id]
 *
 * Delete folder
 * Query params: ?deleteContents=true/false
 *
 * Response Codes:
 * - 200 OK: Folder deleted successfully
 * - 400 Bad Request: Folder not empty and deleteContents=false
 * - 404 Not Found: Folder not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to delete folder
 */
export async function deleteFolder(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const params = await routeContext.params;
    const context = createRequestContext();

    const { searchParams } = new URL(request.url);
    const deleteContents = searchParams.get("deleteContents") === "true";

    await mediaService.deleteFolder(params.id, deleteContents, context);

    return NextResponse.json(
      {
        success: true,
        statusCode: 200,
        message: "Folder deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error, "Delete folder");
  }
}

/**
 * GET /api/media/folders/[id]/contents
 *
 * Get folder contents (subfolders + media files)
 *
 * Response Codes:
 * - 200 OK: Folder contents retrieved successfully
 * - 404 Not Found: Folder not found
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to get folder contents
 */
export async function getFolderContents(
  _request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const params = await routeContext.params;
    const context = createRequestContext();

    const contents = await mediaService.getFolderContents(params.id, context);

    return successResponse(contents, 200);
  } catch (error) {
    return handleError(error, "Get folder contents");
  }
}

/**
 * GET /api/media/folders/root/contents
 *
 * Get root folder contents (folders + media without a folder)
 *
 * Response Codes:
 * - 200 OK: Root folder contents retrieved successfully
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to get root folder contents
 */
export async function getRootFolderContents(
  _request: NextRequest
): Promise<NextResponse> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const contents = await mediaService.getFolderContents(null, context);

    return successResponse(contents, 200);
  } catch (error) {
    return handleError(error, "Get root folder contents");
  }
}
