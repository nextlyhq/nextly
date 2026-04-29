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
 * Wire shape — Task 21 migration: every dispatch method wraps the inner
 * route work in `withErrorHandler` so unmatched paths and service throws
 * surface as canonical `application/problem+json`. JSON responses use
 * `createSuccessResponse` / `createPaginatedResponse` per spec §10.2; the
 * legacy `{ success, statusCode, data }` double-wrap is removed. Per-route
 * `withTimezoneFormatting` still runs on JSON success bodies before they
 * leave the wrapper.
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

import { z } from "zod";

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getNextly, type GetNextlyOptions } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type {
  MediaService,
  ListMediaOptions,
} from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { UploadMediaInputSchema, UpdateMediaInputSchema } from "../types/media";

import {
  createPaginatedResponse,
  createSuccessResponse,
} from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

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
   */
  config?: SanitizedNextlyConfig;
}

let handlerConfig: GetNextlyOptions | undefined;

// ============================================================
// Helper Functions
// ============================================================

async function getMediaService(): Promise<MediaService> {
  await getNextly(handlerConfig);
  return getService("mediaService");
}

function createRequestContext(): RequestContext {
  return {};
}

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

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      },
      logContext: { reason: "invalid-json-body" },
    });
  }
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

function parseMediaRoute(
  path: string[] | undefined,
  method: string
): ParsedMediaRoute {
  const segments = path || [];

  if (segments.length === 0) {
    if (method === "GET") return { type: "list-media" };
    if (method === "POST") return { type: "upload-media" };
    return { type: "not-found" };
  }

  if (segments[0] === "folders") {
    if (segments.length === 1) {
      if (method === "GET") return { type: "list-folders" };
      if (method === "POST") return { type: "create-folder" };
      return { type: "not-found" };
    }

    if (segments[1] === "root" && segments[2] === "contents") {
      if (method === "GET") return { type: "get-root-contents" };
      return { type: "not-found" };
    }

    if (segments.length === 3 && segments[2] === "contents") {
      if (method === "GET")
        return { type: "get-folder-contents", folderId: segments[1] };
      return { type: "not-found" };
    }

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

  if (segments.length === 2 && segments[1] === "move") {
    if (method === "PATCH") return { type: "move-media", mediaId: segments[0] };
    return { type: "not-found" };
  }

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

/**
 * Throw a canonical 404 for paths/methods this dispatcher doesn't serve.
 * The unmatched path/method goes to `logContext` for operator debugging
 * while the public surface stays the canonical "Not found." sentence.
 */
function throwUnmatchedRoute(
  path: string[] | undefined,
  method: string
): never {
  throw NextlyError.notFound({
    logContext: {
      path: path ?? [],
      method,
      reason: "unmatched-media-route",
    },
  });
}

// ============================================================
// Media Operations
// ============================================================

async function handleListMedia(request: Request): Promise<Response> {
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

  return createPaginatedResponse(result.data, {
    total: result.pagination.total,
    page: options.page ?? 1,
    perPage: Math.max(1, options.pageSize ?? 24),
  });
}

async function handleUploadMedia(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const uploadedBy = formData.get("uploadedBy") as string | null;
  const folderId = formData.get("folderId") as string | null;

  const errors: Array<{ path: string; code: string; message: string }> = [];
  if (!file) {
    errors.push({
      path: "file",
      code: "REQUIRED",
      message: "file is required.",
    });
  }
  if (!uploadedBy) {
    errors.push({
      path: "uploadedBy",
      code: "REQUIRED",
      message: "uploadedBy is required.",
    });
  }
  if (errors.length > 0) {
    throw NextlyError.validation({ errors });
  }

  const fileEnsured = file as File;
  const uploadedByEnsured = uploadedBy as string;

  const arrayBuffer = await fileEnsured.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const input = {
    file: buffer,
    filename: fileEnsured.name,
    mimeType: fileEnsured.type,
    size: fileEnsured.size,
    uploadedBy: uploadedByEnsured,
  };

  try {
    UploadMediaInputSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
    throw err;
  }

  const context = createAuthenticatedContext(uploadedByEnsured);

  const mediaFile = await mediaService.upload(
    {
      buffer,
      filename: fileEnsured.name,
      mimeType: fileEnsured.type,
      size: fileEnsured.size,
      folderId: folderId || undefined,
    },
    context
  );

  return createSuccessResponse(mediaFile, { status: 201 });
}

async function handleGetMedia(mediaId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const mediaFile = await mediaService.findById(mediaId, context);

  return createSuccessResponse(mediaFile);
}

async function handleUpdateMedia(
  request: Request,
  mediaId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody(request);

  let validated: z.infer<typeof UpdateMediaInputSchema>;
  try {
    validated = UpdateMediaInputSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
    throw err;
  }

  const context = createRequestContext();

  const mediaFile = await mediaService.update(mediaId, validated, context);

  return createSuccessResponse(mediaFile);
}

async function handleDeleteMedia(mediaId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  await mediaService.delete(mediaId, context);

  return createSuccessResponse({ success: true });
}

async function handleMoveMedia(
  request: Request,
  mediaId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody(request);
  const folderId = body.folderId as string | null | undefined;
  const context = createRequestContext();

  await mediaService.moveToFolder(mediaId, folderId ?? null, context);

  return createSuccessResponse({ success: true });
}

// ============================================================
// Folder Operations
// ============================================================

async function handleListFolders(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const { searchParams } = new URL(request.url);
  const root = searchParams.get("root") === "true";
  const parentId = searchParams.get("parentId");

  const folders =
    root || !parentId
      ? await mediaService.listRootFolders(context)
      : await mediaService.listSubfolders(parentId, context);

  return createSuccessResponse(folders);
}

async function handleCreateFolder(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody(request);

  const { createdBy, ...folderInput } = body as {
    createdBy?: string;
    name?: string;
    [k: string]: unknown;
  };

  const errors: Array<{ path: string; code: string; message: string }> = [];
  if (!createdBy) {
    errors.push({
      path: "createdBy",
      code: "REQUIRED",
      message: "createdBy is required.",
    });
  }
  if (!folderInput.name) {
    errors.push({
      path: "name",
      code: "REQUIRED",
      message: "name is required.",
    });
  }
  if (errors.length > 0) {
    throw NextlyError.validation({ errors });
  }

  const context = createAuthenticatedContext(createdBy as string);
  const folder = await mediaService.createFolder(
    folderInput as Parameters<MediaService["createFolder"]>[0],
    context
  );

  return createSuccessResponse(folder, { status: 201 });
}

async function handleGetFolder(folderId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const folder = await mediaService.findFolderById(folderId, context);

  return createSuccessResponse(folder);
}

async function handleUpdateFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody(request);
  const context = createRequestContext();

  const folder = await mediaService.updateFolder(folderId, body, context);

  return createSuccessResponse(folder);
}

async function handleDeleteFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const { searchParams } = new URL(request.url);
  const deleteContents = searchParams.get("deleteContents") === "true";

  await mediaService.deleteFolder(folderId, deleteContents, context);

  return createSuccessResponse({ success: true });
}

async function handleGetFolderContents(folderId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const contents = await mediaService.getFolderContents(folderId, context);

  return createSuccessResponse(contents);
}

async function handleGetRootContents(): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const contents = await mediaService.getFolderContents(null, context);

  return createSuccessResponse(contents);
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
 */
export function createMediaHandlers(options?: MediaHandlerOptions) {
  if (options?.config) {
    handlerConfig = { config: options.config };
  }
  return {
    GET: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
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
            throwUnmatchedRoute(resolvedParams.path, "GET");
        }

        return withTimezoneFormatting(response);
      }
    ),

    POST: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
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
            throwUnmatchedRoute(resolvedParams.path, "POST");
        }

        return withTimezoneFormatting(response);
      }
    ),

    PATCH: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
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
            throwUnmatchedRoute(resolvedParams.path, "PATCH");
        }

        return withTimezoneFormatting(response);
      }
    ),

    DELETE: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
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
            throwUnmatchedRoute(resolvedParams.path, "DELETE");
        }

        return withTimezoneFormatting(response);
      }
    ),
  };
}
