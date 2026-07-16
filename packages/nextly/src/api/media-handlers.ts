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
 *     const { getNextly } = await import("nextly");
 *     const nextlyConfig = (await import("./nextly.config")).default;
 *     await getNextly({ config: nextlyConfig });
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/media/[[...path]]/route.ts
 * import { createMediaHandlers } from 'nextly/api/media-handlers';
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

import {
  createJsonErrorResponse,
  isErrorResponse,
  requirePermission,
} from "../auth/middleware";
import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly, getNextly, type GetNextlyOptions } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type {
  MediaService,
  ListMediaOptions,
} from "../services/media/media-service";
import type { RequestContext } from "../services/shared";
import { UploadMediaInputSchema, UpdateMediaInputSchema } from "../types/media";

import { executeBulkDelete } from "./media-bulk";
import { readJsonBody } from "./read-json-body";
import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
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
  /**
   * Gate every operation behind a media permission and take the acting
   * identity from the authenticated session/API key rather than the request
   * body. Use this for the admin-facing mount (`/admin/api/media`), where the
   * `Path=/admin` session cookie can reach. The public mount omits it and
   * serves reads only. Off by default so existing public mounts are unchanged
   * in shape (their write verbs stop serving — see below).
   */
  requireAuth?: boolean;
}

let handlerConfig: GetNextlyOptions | undefined;

// ============================================================
// Authorization
// ============================================================

/**
 * The media permission action each route requires. Reads gate on `read`,
 * writes on the verb they perform. `move-media` is an update (it changes the
 * file's folder), and every `*-folder` mutation gates on the same action as
 * the equivalent media mutation.
 */
const MEDIA_ACTION_BY_ROUTE: Partial<
  Record<ParsedMediaRoute["type"], "create" | "read" | "update" | "delete">
> = {
  "list-media": "read",
  "get-media": "read",
  "list-folders": "read",
  "get-folder": "read",
  "get-folder-contents": "read",
  "get-root-contents": "read",
  "upload-media": "create",
  "create-folder": "create",
  "update-media": "update",
  "move-media": "update",
  "update-folder": "update",
  "delete-media": "delete",
  "delete-folder": "delete",
  "bulk-delete-media": "delete",
};

/** Route types that only read — the sole surface the public mount serves. */
const READ_ROUTE_TYPES = new Set<ParsedMediaRoute["type"]>([
  "list-media",
  "get-media",
  "list-folders",
  "get-folder",
  "get-folder-contents",
  "get-root-contents",
]);

/**
 * Gate a parsed route.
 *
 * - Public mount (`requireAuth` false): reads pass; any write is not served
 *   here at all — it 404s exactly like an unknown path, so the public surface
 *   never exposes a write endpoint. Writes live only on the gated admin mount.
 * - Admin mount (`requireAuth` true): every operation is checked with
 *   `requirePermission(req, action, "media")`, which authenticates the session
 *   or API key and verifies the matching `{action}-media` permission. On
 *   success the acting user id is returned so writes attribute to the real
 *   caller, never a client-supplied `uploadedBy`/`createdBy`.
 *
 * Returns a `Response` to short-circuit (401/403), or the acting identity.
 */
async function gateMediaRoute(
  request: Request,
  route: ParsedMediaRoute,
  path: string[] | undefined,
  method: string,
  requireAuth: boolean
): Promise<{ authUserId?: string } | Response> {
  if (!requireAuth) {
    if (!READ_ROUTE_TYPES.has(route.type)) {
      throwUnmatchedRoute(path, method);
    }
    return {};
  }

  const action = MEDIA_ACTION_BY_ROUTE[route.type];
  // Unknown/unsupported route type: let the verb switch produce its 404.
  if (!action) {
    return {};
  }

  // The permission check reads from the DI container, so make sure Nextly is
  // initialised on this worker before it runs.
  await ensureInitialized();
  const auth = await requirePermission(request, action, "media");
  if (isErrorResponse(auth)) {
    return createJsonErrorResponse(auth);
  }
  return { authUserId: auth.userId };
}

// ============================================================
// Helper Functions
// ============================================================

async function ensureInitialized(): Promise<void> {
  // Two paths: if the host called createMediaHandlers({ config }) we have a
  // config to bootstrap with — use getNextly to initialise the storage plugins
  // on this worker. Otherwise we rely on whoever set up instrumentation.ts and
  // just resolve the cached instance via getCachedNextly().
  if (handlerConfig?.config) {
    await getNextly(handlerConfig);
  } else {
    await getCachedNextly();
  }
}

async function getMediaService(): Promise<MediaService> {
  await ensureInitialized();
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
    | "bulk-delete-media"
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

  // "bulk" must be matched before the generic segments.length === 1 block
  // so it is never mistaken for a media ID.
  if (segments[0] === "bulk" && segments.length === 1) {
    if (method === "DELETE") return { type: "bulk-delete-media" };
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
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : 24,
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

  const page = options.page ?? 1;
  const limit = Math.max(1, options.limit ?? 24);
  const total = result.pagination.total;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return respondList(result.data, {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
}

async function handleUploadMedia(
  request: Request,
  authUserId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const folderId = formData.get("folderId") as string | null;

  // The uploader is the authenticated caller, resolved from the session/API
  // key — never a client-supplied `uploadedBy`, which could name anyone.
  const uploadedByEnsured = authUserId;

  if (!file) {
    throw NextlyError.validation({
      errors: [
        { path: "file", code: "REQUIRED", message: "file is required." },
      ],
    });
  }

  // `file` is narrowed to File past the guard above.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const input = {
    file: buffer,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
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
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      folderId: folderId || undefined,
    },
    context
  );

  return respondMutation("Media uploaded.", mediaFile, { status: 201 });
}

async function handleGetMedia(mediaId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const mediaFile = await mediaService.findById(mediaId, context);

  return respondDoc(mediaFile);
}

async function handleUpdateMedia(
  request: Request,
  mediaId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);

  let validated: z.infer<typeof UpdateMediaInputSchema>;
  try {
    validated = UpdateMediaInputSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
    throw err;
  }

  const context = createRequestContext();

  const mediaFile = await mediaService.update(mediaId, validated, context);

  return respondMutation("Media updated.", mediaFile);
}

async function handleDeleteMedia(mediaId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  await mediaService.delete(mediaId, context);

  // Service returns void; surface the deleted id alongside the toast so the
  // admin can update its local cache without a follow-up fetch.
  return respondAction("Media deleted.", { id: mediaId });
}

async function handleMoveMedia(
  request: Request,
  mediaId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);
  const folderId = body.folderId as string | null | undefined;
  const context = createRequestContext();

  await mediaService.moveToFolder(mediaId, folderId ?? null, context);

  // Service returns void; echo the target ids so the admin can update the
  // moved record locally without re-fetching the affected folders.
  return respondAction("Media moved.", {
    id: mediaId,
    folderId: folderId ?? null,
  });
}

async function handleBulkDeleteMedia(request: Request): Promise<Response> {
  const mediaService = await getMediaService();
  return executeBulkDelete(request, mediaService, createRequestContext());
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

  // Folder listings are not server-paginated; use respondData with a named
  // field to keep the bare-array payload addressable without a synthetic
  // pagination envelope.
  return respondData({ folders });
}

async function handleCreateFolder(
  request: Request,
  authUserId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);

  // Ignore any client-supplied `createdBy`; the creator is the authenticated
  // caller.
  const { createdBy: _ignoredCreatedBy, ...folderInput } = body as {
    createdBy?: string;
    name?: string;
    [k: string]: unknown;
  };

  if (!folderInput.name) {
    throw NextlyError.validation({
      errors: [
        { path: "name", code: "REQUIRED", message: "name is required." },
      ],
    });
  }

  const context = createAuthenticatedContext(authUserId);
  const folder = await mediaService.createFolder(
    folderInput as Parameters<MediaService["createFolder"]>[0],
    context
  );

  return respondMutation("Folder created.", folder, { status: 201 });
}

async function handleGetFolder(folderId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const folder = await mediaService.findFolderById(folderId, context);

  return respondDoc(folder);
}

async function handleUpdateFolder(
  request: Request,
  folderId: string
): Promise<Response> {
  const mediaService = await getMediaService();
  const body = await readJsonBody<Record<string, unknown>>(request);
  const context = createRequestContext();

  const folder = await mediaService.updateFolder(folderId, body, context);

  return respondMutation("Folder updated.", folder);
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

  // Service returns void; echo the deleted id so the admin can prune its
  // folder tree locally without a follow-up fetch.
  return respondAction("Folder deleted.", { id: folderId });
}

async function handleGetFolderContents(folderId: string): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const contents = await mediaService.getFolderContents(folderId, context);

  // Folder contents is a structured object (folder, subfolders, mediaFiles,
  // breadcrumbs); ship it bare via respondData for non-CRUD reads.
  return respondData(contents as unknown as Record<string, unknown>);
}

async function handleGetRootContents(): Promise<Response> {
  const mediaService = await getMediaService();
  const context = createRequestContext();

  const contents = await mediaService.getFolderContents(null, context);

  return respondData(contents as unknown as Record<string, unknown>);
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
  // Captured per-instance, not module-level: one process can mount both a
  // public (reads only) and an admin (gated) instance, so this must not leak
  // between them.
  const requireAuth = options?.requireAuth ?? false;

  return {
    GET: withErrorHandler(
      async (request: Request, ctx: RouteContext): Promise<Response> => {
        const resolvedParams = await ctx.params;
        const route = parseMediaRoute(resolvedParams.path, "GET");
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "GET",
          requireAuth
        );
        if (gate instanceof Response) return gate;

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
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "POST",
          requireAuth
        );
        if (gate instanceof Response) return gate;

        let response: Response;
        switch (route.type) {
          case "upload-media":
            response = await handleUploadMedia(request, gate.authUserId!);
            break;
          case "create-folder":
            response = await handleCreateFolder(request, gate.authUserId!);
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
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "PATCH",
          requireAuth
        );
        if (gate instanceof Response) return gate;

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
        const gate = await gateMediaRoute(
          request,
          route,
          resolvedParams.path,
          "DELETE",
          requireAuth
        );
        if (gate instanceof Response) return gate;

        let response: Response;
        switch (route.type) {
          case "delete-media":
            response = await handleDeleteMedia(route.mediaId!);
            break;
          case "delete-folder":
            response = await handleDeleteFolder(request, route.folderId!);
            break;
          case "bulk-delete-media":
            response = await handleBulkDeleteMedia(request);
            break;
          default:
            throwUnmatchedRoute(resolvedParams.path, "DELETE");
        }

        return withTimezoneFormatting(response);
      }
    ),
  };
}
