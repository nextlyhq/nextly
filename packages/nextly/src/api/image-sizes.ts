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
 * Requires `manage-settings` permission.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { z } from "zod";

import {
  createJsonErrorResponse,
  isErrorResponse,
  requireAnyPermission,
} from "../auth/middleware";
import { container } from "../di";
import { getNextly } from "../init";
import { ImageSizeService } from "../services/image-size";
import { MediaRegenerationService } from "../services/media-regeneration";

// Cache service instance after first init
let imageSizeServiceInstance: ImageSizeService | null = null;

async function getImageSizeService(): Promise<ImageSizeService> {
  if (!imageSizeServiceInstance) {
    // Ensure Nextly is initialized (adapter registered in DI container)
    await getNextly();
    const adapter = container.get<DrizzleAdapter>("adapter");
    imageSizeServiceInstance = new ImageSizeService(adapter, console);
  }
  return imageSizeServiceInstance;
}

function successResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json({ data }, { status: statusCode });
}

function errorResponse(message: string, statusCode: number = 500): Response {
  return Response.json({ error: { message } }, { status: statusCode });
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
 * GET /api/image-sizes - List all image sizes
 */
export async function listImageSizes(req: Request): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getImageSizeService();
    const sizes = await service.list();

    return successResponse(sizes);
  } catch (error) {
    console.error("[ImageSizes API] List error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to list image sizes"
    );
  }
}

/**
 * GET /api/image-sizes/:id - Get image size by ID
 */
export async function getImageSizeById(
  req: Request,
  id: string
): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getImageSizeService();
    const size = await service.getById(id);

    if (!size) {
      return errorResponse("Image size not found", 404);
    }

    return successResponse(size);
  } catch (error) {
    console.error("[ImageSizes API] Get error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to get image size"
    );
  }
}

/**
 * POST /api/image-sizes - Create a new image size
 */
export async function createImageSize(req: Request): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const data = createImageSizeSchema.parse(body);

    if (!data.width && !data.height) {
      return errorResponse(
        "At least one dimension (width or height) is required",
        400
      );
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

    return successResponse(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Validation error", 400);
    }
    console.error("[ImageSizes API] Create error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to create image size"
    );
  }
}

/**
 * PATCH /api/image-sizes/:id - Update an image size
 */
export async function updateImageSize(
  req: Request,
  id: string
): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const data = updateImageSizeSchema.parse(body);

    const service = await getImageSizeService();
    const updated = await service.update(id, data);

    return successResponse(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.issues[0]?.message ?? "Validation error", 400);
    }
    console.error("[ImageSizes API] Update error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update image size"
    );
  }
}

/**
 * DELETE /api/image-sizes/:id - Delete an image size
 */
export async function deleteImageSize(
  req: Request,
  id: string
): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getImageSizeService();
    await service.delete(id);

    return successResponse({ deleted: true });
  } catch (error) {
    console.error("[ImageSizes API] Delete error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to delete image size"
    );
  }
}

/**
 * GET /api/image-sizes/regeneration-status - Check regeneration status
 */
export async function getRegenerationStatus(req: Request): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    await getNextly();
    const adapter = container.get<DrizzleAdapter>("adapter");
    const regenService = new MediaRegenerationService(adapter, console);
    const status = await regenService.getRegenerationStatus();

    return successResponse(status);
  } catch (error) {
    console.error("[ImageSizes API] Regeneration status error:", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to get regeneration status"
    );
  }
}

/**
 * POST /api/image-sizes/regenerate - Process a batch of images
 */
export async function regenerateBatch(req: Request): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};

    await getNextly();
    const adapter = container.get<DrizzleAdapter>("adapter");
    const regenService = new MediaRegenerationService(adapter, console);
    const result = await regenService.regenerateBatch({
      batchSize: body.batchSize ?? 10,
      cursor: body.cursor ?? undefined,
    });

    return successResponse(result);
  } catch (error) {
    console.error("[ImageSizes API] Regenerate batch error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to regenerate batch"
    );
  }
}
