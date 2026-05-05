/**
 * Image Sizes API Handler
 *
 * CRUD handlers for named image size configurations:
 *   GET    /api/image-sizes       -> list all image sizes
 *   POST   /api/image-sizes       -> create a new image size
 *   GET    /api/image-sizes/:id   -> get image size by ID
 *   PATCH  /api/image-sizes/:id   -> update image size
 *   DELETE /api/image-sizes/:id   -> delete image size
 *
 * Plus regeneration helpers:
 *   GET    /api/image-sizes/regeneration-status
 *   POST   /api/image-sizes/regenerate
 *
 * Requires `read-settings` (read paths) or `manage-settings` (write paths).
 *
 * The list endpoint is not server-paginated (callers receive every
 * configured image size in one page). To stay on the canonical
 * `respondList` envelope we ship a single-page synthetic meta whose
 * `total` matches the array length (mirrors the api-keys pattern).
 *
 * The regeneration helpers (`getRegenerationStatus`, `regenerateBatch`)
 * are non-CRUD: status is a pure read (`respondData`) and regenerate is a
 * batch action (`respondAction`).
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { ImageSizeService } from "../services/image-size";
import { MediaRegenerationService } from "../services/media-regeneration";

import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

// Cache service instance after first init
let imageSizeServiceInstance: ImageSizeService | null = null;

async function getImageSizeService(): Promise<ImageSizeService> {
  if (!imageSizeServiceInstance) {
    // Ensure Nextly is initialized (adapter registered in DI container)
    await getCachedNextly();
    const adapter = container.get<DrizzleAdapter>("adapter");
    imageSizeServiceInstance = new ImageSizeService(adapter, console);
  }
  return imageSizeServiceInstance;
}

const createImageSizeSchema = z.object({
  name: z.string().min(1).max(50),
  width: z.number().int().positive().max(10000).nullable().optional(),
  height: z.number().int().positive().max(10000).nullable().optional(),
  fit: z
    .enum(["cover", "inside", "contain", "fill"])
    .optional()
    .default("inside"),
  quality: z.number().int().min(1).max(100).optional().default(80),
  format: z
    .enum(["auto", "webp", "jpeg", "png", "avif"])
    .optional()
    .default("auto"),
});

const updateImageSizeSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  width: z.number().int().positive().max(10000).nullable().optional(),
  height: z.number().int().positive().max(10000).nullable().optional(),
  fit: z.enum(["cover", "inside", "contain", "fill"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  format: z.enum(["auto", "webp", "jpeg", "png", "avif"]).optional(),
});

/**
 * GET /api/image-sizes - List all image sizes.
 *
 * Response: `{ items: ImageSize[], meta: PaginationMeta }`. The list is
 * not server-paginated (callers see every configured image size); meta is
 * a single-page synthetic envelope so the wire format matches
 * `respondList` for every list endpoint.
 */
export const listImageSizes = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "read", resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

  const service = await getImageSizeService();
  const sizes = await service.list();

  // Synthetic single-page meta keeps the canonical list shape even though
  // the underlying service does not paginate.
  return respondList(sizes, {
    total: sizes.length,
    page: 1,
    limit: sizes.length,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });
});

/**
 * GET /api/image-sizes/:id - Get image size by ID
 */
export const getImageSizeById = withErrorHandler(
  async (req: Request, id: string) => {
    const authResult = await requireAnyPermission(req, [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getImageSizeService();
    const size = await service.getById(id);

    if (!size) {
      // Identifier kept out of the public message per spec §13.8; operators
      // see the missing id in `logContext`.
      throw NextlyError.notFound({ logContext: { resource: "imageSize", id } });
    }

    return respondDoc(size);
  }
);

/**
 * POST /api/image-sizes - Create a new image size
 */
export const createImageSize = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

  const text = await req.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw NextlyError.validation({
      errors: [
        {
          path: "",
          code: "invalid_json",
          message: "Request body is not valid JSON.",
        },
      ],
    });
  }

  const parsed = createImageSizeSchema.safeParse(body);
  if (!parsed.success) {
    throw nextlyValidationFromZod(parsed.error);
  }
  const data = parsed.data;

  // Cross-field rule: at least one of width/height must be provided. Modeled
  // as a single validation issue so the wire shape stays uniform with zod
  // failures above.
  if (!data.width && !data.height) {
    throw NextlyError.validation({
      errors: [
        {
          path: "",
          code: "missing_dimension",
          message: "At least one dimension (width or height) is required.",
        },
      ],
    });
  }

  const service = await getImageSizeService();
  const created = await service.create({
    name: data.name,
    width: data.width ?? null,
    height: data.height ?? null,
    fit: data.fit,
    quality: data.quality,
    format: data.format,
    isDefault: false, // UI-created sizes are not "default" (code-defined)
  });

  return respondMutation("Image size created.", created, { status: 201 });
});

/**
 * PATCH /api/image-sizes/:id - Update an image size
 */
export const updateImageSize = withErrorHandler(
  async (req: Request, id: string) => {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const text = await req.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw NextlyError.validation({
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      });
    }

    const parsed = updateImageSizeSchema.safeParse(body);
    if (!parsed.success) {
      throw nextlyValidationFromZod(parsed.error);
    }

    const service = await getImageSizeService();
    const updated = await service.update(id, parsed.data);

    return respondMutation("Image size updated.", updated);
  }
);

/**
 * DELETE /api/image-sizes/:id - Delete an image size
 */
export const deleteImageSize = withErrorHandler(
  async (req: Request, id: string) => {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getImageSizeService();
    await service.delete(id);

    // The service returns void, so we surface the deleted id alongside the
    // toast message (mirrors the deleteSingle precedent).
    return respondAction("Image size deleted.", { id });
  }
);

/**
 * GET /api/image-sizes/regeneration-status - Check regeneration status
 */
export const getRegenerationStatus = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

  await getCachedNextly();
  const adapter = container.get<DrizzleAdapter>("adapter");
  const regenService = new MediaRegenerationService(adapter, console);
  const status = await regenService.getRegenerationStatus();

  // Non-CRUD read: surface the status object bare via respondData.
  return respondData(status as unknown as Record<string, unknown>);
});

/**
 * POST /api/image-sizes/regenerate - Process a batch of images
 */
export const regenerateBatch = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

  const text = await req.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw NextlyError.validation({
      errors: [
        {
          path: "",
          code: "invalid_json",
          message: "Request body is not valid JSON.",
        },
      ],
    });
  }

  // Narrow the parsed JSON to the small option set this endpoint accepts;
  // anything else on `body` is ignored.
  const opts =
    body && typeof body === "object"
      ? (body as { batchSize?: unknown; cursor?: unknown })
      : {};
  const batchSize = typeof opts.batchSize === "number" ? opts.batchSize : 10;
  const cursor = typeof opts.cursor === "string" ? opts.cursor : undefined;

  await getCachedNextly();
  const adapter = container.get<DrizzleAdapter>("adapter");
  const regenService = new MediaRegenerationService(adapter, console);
  const result = await regenService.regenerateBatch({ batchSize, cursor });

  // Batch-action endpoint: surface the run summary alongside a toast string
  // via respondAction.
  return respondAction("Regeneration batch processed.", {
    processed: result.processed,
    remaining: result.remaining,
    nextCursor: result.nextCursor,
    failures: result.failures,
  });
});
