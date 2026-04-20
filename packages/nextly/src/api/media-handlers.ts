/**
 * Dynamic Media Route Handler
 *
 * Creates HTTP method handlers for Next.js media API routes using a catch-all pattern.
 * This provides a single handler that routes all media operations (files, folders).
 *
 * Uses a single catch-all route to handle all media-related endpoints,
 * simplifying the consumer's route structure.
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
 * // In your Next.js app: app/api/media/[[...path]]/route.ts
 * import { createMediaHandlers } from '@revnixhq/nextly/api/media-handlers';
 *
 * const handlers = createMediaHandlers();
 * export const GET = handlers.GET;
 * export const POST = handlers.POST;
 * export const PATCH = handlers.PATCH;
 * export const DELETE = handlers.DELETE;
 * ```
 *
 * Supported Routes:
 * - GET    /api/media                        - List media with pagination
 * - POST   /api/media                        - Upload new media file
 * - GET    /api/media/:id                    - Get media by ID
 * - PATCH  /api/media/:id                    - Update media metadata
 * - DELETE /api/media/:id                    - Delete media file
 * - PATCH  /api/media/:id/move               - Move media to folder
 * - GET    /api/media/folders                - List folders
 * - POST   /api/media/folders                - Create folder
 * - GET    /api/media/folders/:id            - Get folder by ID
 * - PATCH  /api/media/folders/:id            - Update folder
 * - DELETE /api/media/folders/:id            - Delete folder
 * - GET    /api/media/folders/:id/contents   - Get folder contents
 * - GET    /api/media/folders/root/contents  - Get root folder contents
 *
 * @module api/media-handlers
 */

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { getService } from "../di";
import { isServiceError } from "../errors";
import { getNextly, type GetNextlyOptions } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type {
  MediaService,
  ListMediaOptions,
} from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { UploadMediaInputSchema, UpdateMediaInputSchema } from "../types/media";

// ============================================================
// Types
// ============================================================

/**
 * Route context for Next.js App Router dynamic routes.
 */
export interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

/**
 * Options for creating media handlers.
 */
export interface MediaHandlerOptions {
  /**
   * Nextly configuration object.
   * Pass this to ensure storage plugins are available even if
   * instrumentation hasn't run in this worker process.
   *
   * @example
   * ```typescript
   * import nextlyConfig from '../../../nextly.config';
   *
   * const handlers = createMediaHandlers({ config: nextlyConfig });
   * ```
   */
  config?: SanitizedNextlyConfig;
}

// Module-level config reference (set by createMediaHandlers)
let handlerConfig: GetNextlyOptions | undefined;

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the MediaService from the DI container.
 */
async function getMediaService(): Promise<MediaService> {
  await getNextly(handlerConfig);
  return getService("mediaService");
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
 * Handle errors from service layer
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
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503);
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

/**
 * Create an unauthenticated request context
 */
function createRequestContext(): RequestContext {
  return {};
}

/**
 * Create an authenticated request context
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
// Route Parsing
// ============================================================

interface ParsedMediaRoute {
  type:
    | "list-media"
    | "upload-media"
    | "get-media"
    | "update-media"
    | "delete-media"
    | "move-media"
    | "list-folders"
    | "create-folder"
    | "get-folder"
    | "update-folder"
    | "delete-folder"
    | "get-folder-contents"
    | "get-root-contents"
    | "not-found";
  mediaId?: string;
  folderId?: string;
}

/**
 * Parse the URL path to determine the media operation
 */
function parseMediaRoute(
  path: string[] | undefined,
  method: string
): ParsedMediaRoute {
  const segments = path || [];

  // /api/media (no path segments)
  if (segments.length === 0) {
    if (method === "GET") return { type: "list-media" };
    if (method === "POST") return { type: "upload-media" };
    return { type: "not-found" };
  }

  // /api/media/folders/...
  if (segments[0] === "folders") {
    // /api/media/folders
    if (segments.length === 1) {
      if (method === "GET") return { type: "list-folders" };
      if (method === "POST") return { type: "create-folder" };
      return { type: "not-found" };
    }

    // /api/media/folders/root/contents
    if (segments[1] === "root" && segments[2] === "contents") {
      if (method === "GET") return { type: "get-root-contents" };
      return { type: "not-found" };
    }

    // /api/media/folders/:id/contents
    if (segments.length === 3 && segments[2] === "contents") {
      if (method === "GET")
        return { type: "get-folder-contents", folderId: segments[1] };
      return { type: "not-found" };
    }

    // /api/media/folders/:id
    if (segments.length === 2) {
      if (method === "GET")
        return { type: "get-folder", folderId: segments[1] };
      if (method === "PATCH")
        return { type: "update-folder", folderId: segments[1] };
      if (method === "DELETE")
        return { type: "delete-folder", folderId: segments[1] };
      return { type: "not-found" };
    }

    return { type: "not-found" };
  }

  // /api/media/:id/move
  if (segments.length === 2 && segments[1] === "move") {
    if (method === "PATCH") return { type: "move-media", mediaId: segments[0] };
    return { type: "not-found" };
  }

  // /api/media/:id
  if (segments.length === 1) {
    if (method === "GET") return { type: "get-media", mediaId: segments[0] };
    if (method === "PATCH")
      return { type: "update-media", mediaId: segments[0] };
    if (method === "DELETE")
      return { type: "delete-media", mediaId: segments[0] };
    return { type: "not-found" };
  }

  return { type: "not-found" };
}

// ============================================================
// Media Operations
// ============================================================

async function handleListMedia(request: Request): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const { searchParams } = new URL(request.url);
    const context = createRequestContext();

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

    return successResponse(result.data, 200, {
      total: result.pagination.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.pagination.total / (options.pageSize ?? 24)),
    });
  } catch (error) {
    return handleError(error, "List media");
  }
}

async function handleUploadMedia(request: Request): Promise<Response> {
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

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

    const context = createAuthenticatedContext(uploadedBy);

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

    return successResponse(mediaFile, 201);
  } catch (error) {
    return handleError(error, "Upload media");
  }
}

async function handleGetMedia(mediaId: string): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const mediaFile = await mediaService.findById(mediaId, context);

    return successResponse(mediaFile, 200);
  } catch (error) {
    return handleError(error, "Get media by ID");
  }
}

async function handleUpdateMedia(
  request: Request,
  mediaId: string
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const body = await request.json();

    const validation = UpdateMediaInputSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(
        validation.error.issues[0]?.message || "Invalid input",
        400
      );
    }

    const context = createRequestContext();

    const mediaFile = await mediaService.update(
      mediaId,
      validation.data,
      context
    );

    return successResponse(mediaFile, 200);
  } catch (error) {
    return handleError(error, "Update media");
  }
}

async function handleDeleteMedia(mediaId: string): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    await mediaService.delete(mediaId, context);

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

async function handleMoveMedia(
  request: Request,
  mediaId: string
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const body = await request.json();
    const { folderId } = body;
    const context = createRequestContext();

    await mediaService.moveToFolder(mediaId, folderId, context);

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

// ============================================================
// Folder Operations
// ============================================================

async function handleListFolders(request: Request): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const { searchParams } = new URL(request.url);
    const root = searchParams.get("root") === "true";
    const parentId = searchParams.get("parentId");

    let folders;

    if (root || !parentId) {
      folders = await mediaService.listRootFolders(context);
    } else {
      folders = await mediaService.listSubfolders(parentId, context);
    }

    return successResponse(folders, 200);
  } catch (error) {
    return handleError(error, "List folders");
  }
}

async function handleCreateFolder(request: Request): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const body = await request.json();

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

async function handleGetFolder(folderId: string): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const folder = await mediaService.findFolderById(folderId, context);

    return successResponse(folder, 200);
  } catch (error) {
    return handleError(error, "Get folder");
  }
}

async function handleUpdateFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const body = await request.json();
    const context = createRequestContext();

    const folder = await mediaService.updateFolder(folderId, body, context);

    return successResponse(folder, 200);
  } catch (error) {
    return handleError(error, "Update folder");
  }
}

async function handleDeleteFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const { searchParams } = new URL(request.url);
    const deleteContents = searchParams.get("deleteContents") === "true";

    await mediaService.deleteFolder(folderId, deleteContents, context);

    return Response.json(
      {
        success: true,
        statusCode: 200,
        message: "Folder deleted successfully",
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Delete folder");
  }
}

async function handleGetFolderContents(folderId: string): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const contents = await mediaService.getFolderContents(folderId, context);

    return successResponse(contents, 200);
  } catch (error) {
    return handleError(error, "Get folder contents");
  }
}

async function handleGetRootContents(): Promise<Response> {
  try {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const contents = await mediaService.getFolderContents(null, context);

    return successResponse(contents, 200);
  } catch (error) {
    return handleError(error, "Get root folder contents");
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Create dynamic HTTP method handlers for Next.js media API routes
 *
 * Use with a catch-all route pattern: app/api/media/[[...path]]/route.ts
 *
 * @param options - Optional configuration including nextly config
 * @returns Object with handlers for GET, POST, PATCH, DELETE
 *
 * @example
 * ```typescript
 * // Basic usage (relies on instrumentation.ts for config)
 * import { createMediaHandlers } from '@revnixhq/nextly/api/media-handlers';
 *
 * const handlers = createMediaHandlers();
 * export const GET = handlers.GET;
 * export const POST = handlers.POST;
 * export const PATCH = handlers.PATCH;
 * export const DELETE = handlers.DELETE;
 * ```
 *
 * @example
 * ```typescript
 * // With explicit config (ensures storage works across workers)
 * import { createMediaHandlers } from '@revnixhq/nextly/api/media-handlers';
 * import nextlyConfig from '../../../nextly.config';
 *
 * const handlers = createMediaHandlers({ config: nextlyConfig });
 * export const GET = handlers.GET;
 * export const POST = handlers.POST;
 * export const PATCH = handlers.PATCH;
 * export const DELETE = handlers.DELETE;
 * ```
 */
export function createMediaHandlers(options?: MediaHandlerOptions) {
  // Store config at module level so getMediaService can use it
  if (options?.config) {
    handlerConfig = { config: options.config };
  }
  return {
    GET: async (request: Request, ctx: RouteContext): Promise<Response> => {
      const resolvedParams = await ctx.params;
      const route = parseMediaRoute(resolvedParams.path, "GET");
      let response: Response;

      switch (route.type) {
        case "list-media":
          response = await handleListMedia(request);
          break;
        case "get-media":
          response = await handleGetMedia(route.mediaId!);
          break;
        case "list-folders":
          response = await handleListFolders(request);
          break;
        case "get-folder":
          response = await handleGetFolder(route.folderId!);
          break;
        case "get-folder-contents":
          response = await handleGetFolderContents(route.folderId!);
          break;
        case "get-root-contents":
          response = await handleGetRootContents();
          break;
        default:
          response = errorResponse("Not found", 404);
          break;
      }

      return withTimezoneFormatting(response);
    },

    POST: async (request: Request, ctx: RouteContext): Promise<Response> => {
      const resolvedParams = await ctx.params;
      const route = parseMediaRoute(resolvedParams.path, "POST");
      let response: Response;

      switch (route.type) {
        case "upload-media":
          response = await handleUploadMedia(request);
          break;
        case "create-folder":
          response = await handleCreateFolder(request);
          break;
        default:
          response = errorResponse("Not found", 404);
          break;
      }

      return withTimezoneFormatting(response);
    },

    PATCH: async (request: Request, ctx: RouteContext): Promise<Response> => {
      const resolvedParams = await ctx.params;
      const route = parseMediaRoute(resolvedParams.path, "PATCH");
      let response: Response;

      switch (route.type) {
        case "update-media":
          response = await handleUpdateMedia(request, route.mediaId!);
          break;
        case "move-media":
          response = await handleMoveMedia(request, route.mediaId!);
          break;
        case "update-folder":
          response = await handleUpdateFolder(request, route.folderId!);
          break;
        default:
          response = errorResponse("Not found", 404);
          break;
      }

      return withTimezoneFormatting(response);
    },

    DELETE: async (request: Request, ctx: RouteContext): Promise<Response> => {
      const resolvedParams = await ctx.params;
      const route = parseMediaRoute(resolvedParams.path, "DELETE");
      let response: Response;

      switch (route.type) {
        case "delete-media":
          response = await handleDeleteMedia(route.mediaId!);
          break;
        case "delete-folder":
          response = await handleDeleteFolder(request, route.folderId!);
          break;
        default:
          response = errorResponse("Not found", 404);
          break;
      }

      return withTimezoneFormatting(response);
    },
  };
}
