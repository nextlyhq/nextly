/**
 * General Settings API Handler
 *
 * Handlers for the general settings singleton endpoint:
 *   GET  /api/nextly/general-settings  → retrieve current settings
 *   PATCH /api/nextly/general-settings → update settings
 *
 * Requires `manage-settings` permission for both operations.
 *
 * @module api/general-settings
 * @since 1.0.0
 */

import { z } from "zod";

import {
  createJsonErrorResponse,
  isErrorResponse,
  requireAnyPermission,
} from "../auth/middleware";
import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";

async function getGeneralSettingsService(): Promise<GeneralSettingsService> {
  await getNextly();
  return container.get<GeneralSettingsService>("generalSettingsService");
}

function successResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json({ data: { data } }, { status: statusCode });
}

function errorResponse(
  message: string,
  statusCode: number = 500,
  code?: string
): Response {
  return Response.json(
    { error: { message, ...(code && { code }) } },
    { status: statusCode }
  );
}

function handleError(error: unknown, operation: string): Response {
  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return errorResponse(
      first?.message ?? "Validation error",
      400,
      "VALIDATION_ERROR"
    );
  }

  if (error instanceof Error) {
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

const updateSettingsSchema = z.object({
  applicationName: z.string().max(255).nullable().optional(),
  siteUrl: z
    .string()
    .url("Site URL must be a valid URL")
    .max(2048)
    .nullable()
    .optional(),
  adminEmail: z
    .string()
    .email("Admin email must be a valid email address")
    .max(255)
    .nullable()
    .optional(),
  timezone: z.string().max(100).nullable().optional(),
  dateFormat: z.string().max(50).nullable().optional(),
  timeFormat: z.string().max(50).nullable().optional(),
  logoUrl: z
    .string()
    .url("Logo URL must be a valid URL")
    .max(2048)
    .nullable()
    .optional(),
});

/**
 * GET /api/nextly/general-settings
 *
 * Returns the current general settings.
 * Auth: manage-settings permission.
 */
export async function getGeneralSettings(req: Request): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getGeneralSettingsService();
    const settings = await service.getSettings();

    return withTimezoneFormatting(successResponse(settings));
  } catch (error) {
    return handleError(error, "Get general settings");
  }
}

/**
 * PATCH /api/nextly/general-settings
 *
 * Updates the general settings. All fields are optional.
 * Auth: manage-settings permission.
 */
export async function updateGeneralSettings(req: Request): Promise<Response> {
  try {
    const authResult = await requireAnyPermission(req, [
      { action: "update", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const data = updateSettingsSchema.parse(body);

    const service = await getGeneralSettingsService();
    const updated = await service.updateSettings(data);

    return withTimezoneFormatting(successResponse(updated));
  } catch (error) {
    return handleError(error, "Update general settings");
  }
}
