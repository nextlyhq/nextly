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
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and
 * return the canonical `{ data: <result> }` (or `{ data: [...], meta:
 * { total, page, perPage } }` for paginated lists) per spec §10.2. Errors
 * flow through the wrapper as `application/problem+json`. The legacy
 * double-wrap `{ success, statusCode, data }` is dropped; delete/move
 * success becomes `{ data: { success: true } }`. Validation failures
 * surface field-level detail in `data.errors[]`.
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

import { z } from "zod";

import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
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
import { readJsonBody } from "./read-json-body";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getMediaService(): Promise<MediaService> {
  await getNextly();
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
 * GET handler for listing media with pagination, search, and filters.
 *
 * Query Parameters:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 24, becomes `perPage` in response meta)
 * - search: Search query for filename, altText
 * - type: Filter by media type (image, video, audio, document, other)
 * - folderId: Filter by folder ("root" for root-level media)
 * - sortBy: Sort field (uploadedAt, filename, size)
 * - sortOrder: Sort direction (asc, desc)
 *
 * Response: `{ "data": Media[], "meta": { total, page, perPage } }`.
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
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

    // Canonical pagination meta per spec §10.2: `{ total, page, perPage }`.
    // The legacy `totalPages` field is dropped — callers compute it as
    // `Math.ceil(total / perPage)`.
    return withTimezoneFormatting(
      createPaginatedResponse(result.data, {
        total: result.pagination.total,
        page: options.page ?? 1,
        perPage: Math.max(1, options.pageSize ?? 24),
      })
    );
  }
);

/**
 * POST handler for uploading media files.
 *
 * Accepts multipart/form-data with a 'file' field and metadata.
 * Automatically processes images (thumbnails, dimensions).
 *
 * Form Data:
 * - file: File to upload (required)
 * - uploadedBy: User ID (required)
 * - folderId: Optional folder to upload into.
 *
 * Response: `{ "data": Media }` (status 201).
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
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

    // file & uploadedBy are guaranteed defined after the validation above.
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

    return withTimezoneFormatting(
      createSuccessResponse(mediaFile, { status: 201 })
    );
  }
);

/**
 * GET handler for fetching a single media item by ID.
 *
 * Response: `{ "data": Media }`. 404 surface emits canonical
 * `application/problem+json` with `code: "NOT_FOUND"`.
 */
export function getMediaById(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      _req: Request,
      routeCtx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const { id } = await routeCtx.params;
      const context = createRequestContext();

      const mediaFile = await mediaService.findById(id, context);

      return withTimezoneFormatting(createSuccessResponse(mediaFile));
    }
  )(request, ctx);
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
 * Response: `{ "data": Media }`.
 */
export function updateMedia(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      req: Request,
      routeCtx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const body = await readJsonBody<Record<string, unknown>>(req);

      let validated: z.infer<typeof UpdateMediaInputSchema>;
      try {
        validated = UpdateMediaInputSchema.parse(body);
      } catch (err) {
        if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
        throw err;
      }

      const { id } = await routeCtx.params;
      const context = createRequestContext();

      const mediaFile = await mediaService.update(id, validated, context);

      return withTimezoneFormatting(createSuccessResponse(mediaFile));
    }
  )(request, ctx);
}

/**
 * DELETE handler for deleting media files.
 *
 * Removes media from both storage and database.
 *
 * Response: `{ "data": { "success": true } }`.
 */
export function deleteMedia(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      _req: Request,
      routeCtx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const { id } = await routeCtx.params;
      const context = createRequestContext();

      await mediaService.delete(id, context);

      return createSuccessResponse({ success: true });
    }
  )(request, ctx);
}

/**
 * PATCH handler for moving media to a folder
 *
 * Path: /api/media/[id]/move
 * Body: { folderId: string | null }
 *
 * Response: `{ "data": { "success": true } }`.
 */
export function moveMediaToFolder(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withErrorHandler(
    async (
      req: Request,
      routeCtx: { params: Promise<{ id: string }> }
    ): Promise<Response> => {
      const mediaService = await getMediaService();
      const { id } = await routeCtx.params;
      const body = await readJsonBody<Record<string, unknown>>(req);
      const folderId = body.folderId as string | null | undefined;
      const context = createRequestContext();

      await mediaService.moveToFolder(id, folderId ?? null, context);

      return createSuccessResponse({ success: true });
    }
  )(request, ctx);
}
