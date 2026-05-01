/**
 * General Settings API Handler
 *
 * Handlers for the general settings singleton endpoint:
 *   GET  /api/nextly/general-settings  → retrieve current settings
 *   PATCH /api/nextly/general-settings → update settings
 *
 * Requires `manage-settings` permission for both operations.
 *
 * Wire shape — Task 21 migration: handlers now wrap `withErrorHandler` and
 * return the canonical `{ data: <settings> }` envelope per spec §10.2. The
 * legacy implementation accidentally double-wrapped as
 * `{ data: { data: <settings> } }`; clients that depended on the inner field
 * are updated in Task 10 (admin frontend simplification). Errors flow through
 * `withErrorHandler` and serialize as `application/problem+json`.
 *
 * @module api/general-settings
 * @since 1.0.0
 */

import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getGeneralSettingsService(): Promise<GeneralSettingsService> {
  await getCachedNextly();
  return container.get<GeneralSettingsService>("generalSettingsService");
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
 * Auth: read-settings or manage-settings permission.
 */
export const getGeneralSettings = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "read", resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

  const service = await getGeneralSettingsService();
  const settings = await service.getSettings();

  // Canonical `{ data: <settings> }` envelope; the timezone wrapper rewrites
  // timestamp fields in-place without changing the envelope shape.
  return withTimezoneFormatting(createSuccessResponse(settings));
});

/**
 * PATCH /api/nextly/general-settings
 *
 * Updates the general settings. All fields are optional.
 * Auth: update-settings or manage-settings permission.
 */
export const updateGeneralSettings = withErrorHandler(async (req: Request) => {
  const authResult = await requireAnyPermission(req, [
    { action: "update", resource: "settings" },
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

  // Convert zod failures into the unified validation error so the wire shape
  // matches spec §10.2 (`error.publicData.errors[]`) instead of a single
  // legacy message. Service-level domain failures throw `NextlyError` already
  // and bubble untouched.
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throw nextlyValidationFromZod(parsed.error);
  }

  const service = await getGeneralSettingsService();
  const updated = await service.updateSettings(parsed.data);

  return withTimezoneFormatting(createSuccessResponse(updated));
});
