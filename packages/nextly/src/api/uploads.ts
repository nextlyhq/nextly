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
 * `UploadServiceResult` (a result-shape, not a throw) is unwrapped via
 * `throwFromUploadResult`: 404 to `NextlyError.notFound`, 400 to
 * `NextlyError.validation` with field-level errors, 503 to
 * `NextlyError.serviceUnavailable`, anything else to `NextlyError.internal`.
 *
 * @module api/uploads
 */

import { container } from "../di/container";
import { isServicesRegistered, getService } from "../di/register";
import { clampLimit } from "../domains/collections/query/query-parser";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import {
  UploadService,
  type UploadConfig,
  type UploadServiceResult,
} from "../services/upload-service";
import { getMediaStorage } from "../storage/storage";
import {
  checkRequestSize,
  resolveSecurityLimits,
  type ResolvedSecurityLimits,
} from "../utils/parse-byte-size";

import {
  respondAction,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/**
 * Pull `security.limits` from the registered config via DI. Falls back to
 * defaults if config isn't initialized (test harness) or has no `limits`
 * block.
 */
function resolveSecurityLimitsFromContainer(): ResolvedSecurityLimits {
  try {
    if (!container.has("config")) return resolveSecurityLimits(undefined);
    const cfg = container.get<{
      security?: { limits?: Parameters<typeof resolveSecurityLimits>[0] };
    }>("config");
    return resolveSecurityLimits(cfg?.security?.limits);
  } catch {
    return resolveSecurityLimits(undefined);
  }
}

interface UploadRouteParams {
  slug: string;
  id?: string;
}

/**
 * Get or create the UploadService for a collection.
 *
 * Reads `security.uploads` from the Nextly config to apply
 * `additionalMimeTypes`, `allowedMimeTypes`, and `svgCsp` settings.
 * Server-side validation provides reasonable defaults to prevent abuse;
 * client-side validation enforces field-specific constraints
 * (`maxFileSize`, `mimeTypes`).
 */
function getUploadService(
  _collectionSlug: string,
  config?: Partial<UploadConfig>
): UploadService {
  const storage = getMediaStorage().getAdapter();

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
    maxSize: config?.maxSize,
    allowedMimeTypes:
      config?.allowedMimeTypes ?? uploadSecurityConfig?.allowedMimeTypes,
    additionalMimeTypes:
      config?.additionalMimeTypes ?? uploadSecurityConfig?.additionalMimeTypes,
    svgCsp: uploadSecurityConfig?.svgCsp,
    generateThumbnails: config?.generateThumbnails,
    thumbnailSize: config?.thumbnailSize,
  });
}

/** Re-exported for tests that exercise the singleton lifecycle. */
export function resetUploadService(): void {
  // No-op: the singleton was unused. Kept as an export so test imports don't
  // break; the function intentionally does no work.
}

async function ensureServicesInitialized(): Promise<void> {
  await getCachedNextly();
}

async function extractParams(
  params: Promise<{ slug?: string; id?: string }>
): Promise<UploadRouteParams> {
  const resolved = await params;
  return {
    slug: resolved.slug || "",
    id: resolved.id,
  };
}

function requireSlug(slug: string): void {
  if (!slug) {
    throw NextlyError.validation({
      errors: [
        {
          path: "slug",
          code: "REQUIRED",
          message: "Collection slug is required.",
        },
      ],
      logContext: { reason: "missing-collection-slug" },
    });
  }
}

/**
 * Convert an `UploadServiceResult` failure into a thrown `NextlyError`.
 *
 * Status-to-code mapping:
 *   400 to `NextlyError.validation` with `errors[]` mapped from
 *       `result.errors` (`{field, message}` to `{path, code, message}`).
 *   404 to `NextlyError.notFound` (canonical "Not found." public message;
 *       the original `result.message` lives in `logContext`).
 *   503 to `NextlyError.serviceUnavailable`.
 *   else to `NextlyError.internal`.
 *
 * The `result.message` and the original status code are preserved in
 * `logContext` so operators can correlate the unified wire payload with
 * the storage adapter's diagnostic.
 */
function throwFromUploadResult(
  result: UploadServiceResult<unknown>,
  operation: string
): never {
  const logContext: Record<string, unknown> = {
    operation,
    legacyStatus: result.statusCode,
    legacyMessage: result.message,
  };

  if (result.statusCode === 404) {
    throw NextlyError.notFound({ logContext });
  }

  if (result.statusCode === 400) {
    const errors =
      result.errors && result.errors.length > 0
        ? result.errors.map(e => ({
            path: e.field ?? "",
            code: "INVALID_INPUT",
            message: e.message,
          }))
        : [
            {
              path: "",
              code: "INVALID_INPUT",
              message: result.message ?? "Invalid input.",
            },
          ];
    throw NextlyError.validation({ errors, logContext });
  }

  if (result.statusCode === 503) {
    throw NextlyError.serviceUnavailable({ logContext });
  }

  throw NextlyError.internal({ logContext });
}

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
 * Response: `{ message, item: UploadResult }` (respondMutation, status 201)
 * post-processed through `withTimezoneFormatting`.
 */
export const POST = withErrorHandler(
  async (
    request: Request,
    context: { params: Promise<{ slug?: string }> }
  ): Promise<Response> => {
    await ensureServicesInitialized();

    const { slug } = await extractParams(context.params);
    requireSlug(slug);

    // Cheap Content-Length guard. Reject obvious DoS bodies before they get
    // buffered. Per-file size + per-request file-count caps are still
    // enforced after parse below.
    const limits = resolveSecurityLimitsFromContainer();
    const tooLarge = checkRequestSize(request, limits.multipart);
    if (tooLarge) return tooLarge;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      throw NextlyError.validation({
        errors: [
          { path: "file", code: "REQUIRED", message: "file is required." },
        ],
        logContext: { reason: "missing-file" },
      });
    }

    // Per-file size cap. Cheap multipart bodies can pass the Content-Length
    // check yet still ship one giant file; cap each file individually.
    if (file.size > limits.fileSize) {
      return new Response(
        JSON.stringify({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: `File "${file.name}" (${file.size} bytes) exceeds the configured per-file limit of ${limits.fileSize} bytes.`,
          },
        }),
        { status: 413, headers: { "content-type": "application/json" } }
      );
    }

    // `_payload` is optional metadata. Invalid JSON is tolerated; we ignore
    // unparseable `_payload` rather than failing the upload.
    const payloadStr = formData.get("_payload") as string | null;
    let additionalData: Record<string, unknown> = {};
    if (payloadStr) {
      try {
        additionalData = JSON.parse(payloadStr);
      } catch {
        // Intentional swallow; see comment above.
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadService = getUploadService(slug);
    const result = await uploadService.upload(buffer, {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      collectionSlug: slug,
    });

    if (!result.success) {
      throwFromUploadResult(result, "upload");
    }

    // Transform to client-expected format.
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

    return withTimezoneFormatting(
      respondMutation("Upload created.", uploadData, { status: 201 })
    );
  }
);

/**
 * GET handler — dual-purpose: with `id` returns metadata for a single
 * upload; without `id` returns the (currently empty) collection list.
 *
 * Path: /admin/api/collections/[slug]/uploads/[id]
 *
 * Response Codes:
 * - 200 OK: Metadata retrieved successfully
 * - 400 Bad Request: Missing collection slug or upload ID
 * - 404 Not Found: Upload not found
 * - 500 Internal Server Error: Failed to get metadata
 *
 * Response: bare `UploadMetadata` (respondDoc) for single; for list see
 * `handleList` (paginated `respondList` shape).
 */
export const GET = withErrorHandler(
  async (
    request: Request,
    context: { params: Promise<{ slug?: string; id?: string }> }
  ): Promise<Response> => {
    await ensureServicesInitialized();

    const { slug, id } = await extractParams(context.params);
    requireSlug(slug);

    if (!id) {
      return handleList(request, slug);
    }

    const uploadService = getUploadService(slug);
    const filePath = `${slug}/${id}`;
    const result = await uploadService.getMetadata(filePath);

    if (!result.success) {
      throwFromUploadResult(result, "get-metadata");
    }

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

    return withTimezoneFormatting(respondDoc(uploadData));
  }
);

/**
 * Handle list request for uploads in a collection. Currently returns an
 * empty list; a real implementation would query a database or enumerate
 * the storage adapter. Wire shape is the canonical respondList envelope.
 */
async function handleList(request: Request, _slug: string): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get("page") || "1", 10);
  // Clamp `limit` to MAX_QUERY_LIMIT so a client can't yank an entire upload
  // list in one round-trip.
  const limit = clampLimit(searchParams.get("limit"), { defaultLimit: 10 });

  const total = 0;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return withTimezoneFormatting(
    respondList([], {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
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
 * Response: `{ message, id }` (respondAction; storage delete returns void).
 */
export const DELETE = withErrorHandler(
  async (
    _request: Request,
    context: { params: Promise<{ slug?: string; id?: string }> }
  ): Promise<Response> => {
    await ensureServicesInitialized();

    const { slug, id } = await extractParams(context.params);
    requireSlug(slug);

    if (!id) {
      throw NextlyError.validation({
        errors: [
          { path: "id", code: "REQUIRED", message: "Upload ID is required." },
        ],
        logContext: { reason: "missing-upload-id" },
      });
    }

    const uploadService = getUploadService(slug);
    const filePath = `${slug}/${id}`;
    const result = await uploadService.delete(filePath);

    if (!result.success) {
      throwFromUploadResult(result, "delete");
    }

    // Storage delete returns void; surface the deleted upload id so the
    // admin can prune its local cache without a follow-up fetch.
    return respondAction("Upload deleted.", { id });
  }
);

/** Alias for GET when used for listing (semantic export). */
export const LIST = GET;
