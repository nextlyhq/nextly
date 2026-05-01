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
 * Wire shape — Task 21 migration: handler wraps `withErrorHandler` and
 * returns the canonical `{ data: <result> }` envelope per spec §10.2.
 * The legacy double-wrap `{ success, statusCode, data }` is dropped;
 * admin / SDK callers reading `response.success` break until Task 10
 * migrates the consuming fetcher (F12 admin-gap ledger).
 *
 * Adapter-specific failures (no plugin, `clientUploads` not enabled,
 * Vercel-Blob `handleUpload` style adapters) collapse to canonical
 * `NextlyError.validation` shapes — public messages are §13.8 sentences
 * with no collection-slug identifiers; the slug lives in `logContext`.
 *
 * @module api/storage-upload-url
 */

import { z } from "zod";

import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getMediaStorage } from "../storage/storage";
import type { ClientUploadData } from "../storage/types";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function ensureServicesInitialized(): Promise<void> {
  await getCachedNextly();
}

const uploadUrlRequestSchema = z.object({
  filename: z.string().min(1, "filename is required"),
  mimeType: z.string().min(1, "mimeType is required"),
  collection: z.string().min(1, "collection is required"),
  expiresIn: z.number().int().positive().optional(),
});

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
 * Response: `{ "data": ClientUploadData }` — see the `ClientUploadData`
 * type for the field shape (`uploadUrl`, `path`, `method`, `headers`,
 * `expiresAt`).
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await ensureServicesInitialized();

    let raw: unknown;
    try {
      raw = await request.json();
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

    let validated: z.infer<typeof uploadUrlRequestSchema>;
    try {
      validated = uploadUrlRequestSchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const { filename, mimeType, collection } = validated;

    const storage = getMediaStorage();

    if (!storage.supportsClientUploads(collection)) {
      // Diagnose why and surface a canonical validation error. Public
      // messages avoid the collection slug per §13.8 — the slug rides in
      // logContext for operator triage.
      const config = storage.getCollectionConfig(collection);
      const adapter = storage.getAdapterForCollection(collection);
      const adapterInfo = adapter.getInfo?.();

      const baseLogContext: Record<string, unknown> = {
        collection,
        adapterType: adapterInfo?.type,
      };

      if (!config) {
        throw NextlyError.validation({
          errors: [
            {
              path: "collection",
              code: "STORAGE_NOT_CONFIGURED",
              message:
                "This collection is not configured with a storage plugin.",
            },
          ],
          logContext: { ...baseLogContext, reason: "no-storage-plugin" },
        });
      }

      if (!config.clientUploads) {
        throw NextlyError.validation({
          errors: [
            {
              path: "collection",
              code: "CLIENT_UPLOADS_DISABLED",
              message: "Client uploads are not enabled for this collection.",
            },
          ],
          logContext: {
            ...baseLogContext,
            reason: "clientUploads-not-enabled",
          },
        });
      }

      if (!adapterInfo?.supportsClientUploads) {
        throw NextlyError.validation({
          errors: [
            {
              path: "collection",
              code: "ADAPTER_UNSUPPORTED",
              message:
                "The configured storage adapter does not support client uploads.",
            },
          ],
          logContext: {
            ...baseLogContext,
            reason: "adapter-unsupported",
          },
        });
      }

      // Fallback for diagnostic gaps (none of the three checks matched).
      throw NextlyError.validation({
        errors: [
          {
            path: "collection",
            code: "CLIENT_UPLOADS_DISABLED",
            message: "Client uploads are not enabled for this collection.",
          },
        ],
        logContext: { ...baseLogContext, reason: "unknown" },
      });
    }

    let uploadData: ClientUploadData | null;
    try {
      uploadData = await storage.getClientUploadUrl(
        filename,
        mimeType,
        collection
      );
    } catch (err) {
      // Vercel Blob-style adapters require a different upload flow
      // (`handleUpload` in the route), not pre-signed URLs. Surface a
      // 400 with the canonical "use the standard upload endpoint" hint.
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("handleupload")
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "collection",
              code: "ADAPTER_UNSUPPORTED",
              message:
                "This storage provider does not support pre-signed upload URLs. Use the standard upload endpoint instead.",
            },
          ],
          logContext: {
            collection,
            reason: "adapter-no-presigned-urls",
            cause: err.message,
          },
        });
      }
      throw err;
    }

    if (!uploadData) {
      throw NextlyError.internal({
        logContext: {
          collection,
          reason: "presigned-url-generation-returned-null",
        },
      });
    }

    return createSuccessResponse(uploadData);
  }
);
