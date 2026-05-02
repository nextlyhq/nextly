/**
 * General Settings API Handler
 *
 * Handlers for the general settings singleton endpoint:
 *   GET  /api/nextly/general-settings  → retrieve current settings
 *   PATCH /api/nextly/general-settings → update settings
 *
 * Requires `manage-settings` permission for both operations.
 *
 * Wire shape: Phase 4 Task 11 migrates these handlers off the legacy
 * `{ data: <settings> }` envelope onto the canonical respondX helpers
 * (spec §5.1). GET uses `respondData` (bare object read). PATCH uses
 * `respondMutation` so the admin gets a server-authored toast string
 * alongside the updated row. Errors flow through `withErrorHandler`
 * and serialize as `application/problem+json`.
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

import { respondData, respondMutation } from "./response-shapes";
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

  // Phase 4: respondData (bare object). The timezone wrapper rewrites
  // timestamp fields in-place without changing the body shape, so the
  // bare-data wire format flows through unchanged. Spread into a fresh
  // literal so the named settings interface satisfies the respondData
  // `Record<string, unknown>` bound.
  return withTimezoneFormatting(respondData({ ...settings }));
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

  // Phase 4: respondMutation. The settings row is the mutated `item` and
  // the message powers the admin toast. The timezone wrapper rewrites the
  // nested settings fields in-place; the `{ message, item }` envelope is
  // preserved untouched because timestamp normalization only walks values.
  return withTimezoneFormatting(
    respondMutation("General settings updated.", updated)
  );
});
