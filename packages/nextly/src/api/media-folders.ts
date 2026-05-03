/**
 * Media Folders API Route Handlers
 *
 * Next.js App Router compatible handlers for folder management operations.
 * Re-export these handlers in your app's API routes.
 *
 * **IMPORTANT:** For storage plugins to work, initialize Nextly with your config
 * via instrumentation.ts before these routes are called.
 *
 * Wire shape (Phase 4.6 migration): handlers wrap `withErrorHandler` and
 * return canonical respondX bodies (spec section 5.1):
 *   - list/contents: `respondData({ folders })` / `respondData(contents)`
 *   - findByID: `respondDoc(folder)`
 *   - create/update: `respondMutation(message, folder)`
 *   - delete (no doc): `respondAction(message, { id })`
 * Errors still flow through `withErrorHandler` as `application/problem+json`.
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

import type { NextRequest } from "next/server";

import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { MediaService } from "../services/media/media-service";
import type { RequestContext } from "../services/shared";

import { readJsonBody } from "./read-json-body";
import {
  respondAction,
  respondData,
  respondDoc,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

async function getMediaService(): Promise<MediaService> {
  await getCachedNextly();
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

/**
 * GET /api/media/folders
 *
 * List folders with optional filtering:
 * - ?root=true - List only root folders (no parent)
 * - ?parentId=xxx - List subfolders of a specific parent
 *
 * Response: `{ "folders": Folder[] }` (non-paginated; respondData with a
 * named field).
 */
export const GET = withErrorHandler(
  async (request: NextRequest): Promise<Response> => {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const { searchParams } = new URL(request.url);
    const root = searchParams.get("root") === "true";
    const parentId = searchParams.get("parentId");

    const folders =
      root || !parentId
        ? await mediaService.listRootFolders(context)
        : await mediaService.listSubfolders(parentId, context);

    return respondData({ folders });
  }
);

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
 * Response: `{ "message", "item": Folder }` (status 201).
 */
export const POST = withErrorHandler(
  async (request: NextRequest): Promise<Response> => {
    const mediaService = await getMediaService();
    const body = await readJsonBody<Record<string, unknown>>(request);

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

    return respondMutation("Folder created.", folder, { status: 201 });
  }
);

/**
 * GET /api/media/folders/[id]
 *
 * Get folder by ID
 */
export function getFolderById(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      _req: NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const params = await ctx.params;
      const context = createRequestContext();

      const folder = await mediaService.findFolderById(params.id, context);

      return respondDoc(folder);
    }
  )(request, routeContext);
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
 */
export function updateFolder(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      req: NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const params = await ctx.params;
      const body = await readJsonBody<Record<string, unknown>>(req);
      const context = createRequestContext();

      const folder = await mediaService.updateFolder(params.id, body, context);

      return respondMutation("Folder updated.", folder);
    }
  )(request, routeContext);
}

/**
 * DELETE /api/media/folders/[id]
 *
 * Delete folder
 * Query params: ?deleteContents=true/false
 *
 * Response: `{ "message", "id" }` (respondAction; service returns void).
 */
export function deleteFolder(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      req: NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const params = await ctx.params;
      const context = createRequestContext();

      const { searchParams } = new URL(req.url);
      const deleteContents = searchParams.get("deleteContents") === "true";

      await mediaService.deleteFolder(params.id, deleteContents, context);

      // Service returns void; echo the deleted id so the admin can prune
      // its folder tree locally without a follow-up fetch.
      return respondAction("Folder deleted.", { id: params.id });
    }
  )(request, routeContext);
}

/**
 * GET /api/media/folders/[id]/contents
 *
 * Get folder contents (subfolders + media files)
 */
export function getFolderContents(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      _req: NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const params = await ctx.params;
      const context = createRequestContext();

      const contents = await mediaService.getFolderContents(params.id, context);

      // Folder contents is a structured object (folder, subfolders,
      // mediaFiles, breadcrumbs); ship it bare via respondData for the
      // non-CRUD read shape.
      return respondData(contents as unknown as Record<string, unknown>);
    }
  )(request, routeContext);
}

/**
 * GET /api/media/folders/root/contents
 *
 * Get root folder contents (folders + media without a folder)
 */
export const getRootFolderContents = withErrorHandler(
  async (_request: NextRequest): Promise<Response> => {
    const mediaService = await getMediaService();
    const context = createRequestContext();

    const contents = await mediaService.getFolderContents(null, context);

    return respondData(contents as unknown as Record<string, unknown>);
  }
);
