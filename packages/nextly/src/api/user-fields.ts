/**
 * User Field Definitions API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * user field definition management endpoints at /api/user-fields.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/user-fields/route.ts
 * export { GET, POST } from 'nextly/api/user-fields';
 * ```
 *
 * GET returns `{ data: { fields, adminConfig? } }`. Spec §10.2 reserves
 * `meta` for pagination only, so the user `adminConfig` rides as a sibling
 * inside `data` (same structured-data pattern as `createApiKey`'s
 * `{ data: { doc, key } }`).
 *
 * @module api/user-fields
 */

import { z } from "zod";

import { container } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import { getCachedNextly } from "../init";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";
import { checkUserFieldType } from "../users/config/validate-user-config";

import { readJsonBody } from "./read-json-body";
import { respondData, respondMutation } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getUserFieldDefinitionService(): Promise<UserFieldDefinitionService> {
  await getCachedNextly();
  return container.get<UserFieldDefinitionService>(
    "userFieldDefinitionService"
  );
}

const optionSchema = z.object({
  label: z.string().min(1, "Option label is required"),
  value: z.string().min(1, "Option value is required"),
});

const createFieldSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(255)
      .regex(
        /^[a-zA-Z][a-zA-Z0-9]*$/,
        "Name must start with a letter and contain only alphanumeric characters"
      ),
    label: z.string().min(1, "Label is required").max(255),
    // Delegates to the single source of truth (checkUserFieldType) instead of a
    // hardcoded enum, so a plugin field type that opted into the users surface
    // is accepted here as well as a built-in scalar. A missing/non-string value
    // reports the canonical "type required" message rather than a raw zod type
    // error, matching what the definition service would raise.
    type: z
      .string({ message: "Field type is required" })
      .superRefine((value, ctx) => {
        const rejection = checkUserFieldType(value);
        if (rejection) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: rejection.message,
          });
        }
      }),
    required: z.boolean().optional(),
    defaultValue: z.string().optional().nullable(),
    options: z.array(optionSchema).optional().nullable(),
    hasMany: z.boolean().optional().nullable(),
    minLength: z.number().int().min(0).optional().nullable(),
    maxLength: z.number().int().min(1).optional().nullable(),
    minValue: z.number().optional().nullable(),
    maxValue: z.number().optional().nullable(),
    placeholder: z.string().max(255).optional().nullable(),
    description: z.string().optional().nullable(),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // An inverted range would make every value invalid; refuse it at the
    // boundary instead of persisting a field nobody can satisfy.
    if (
      data.minLength != null &&
      data.maxLength != null &&
      data.minLength > data.maxLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minLength"],
        message: "minLength cannot exceed maxLength",
      });
    }
    if (
      data.minValue != null &&
      data.maxValue != null &&
      data.minValue > data.maxValue
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minValue"],
        message: "minValue cannot exceed maxValue",
      });
    }
  });

/**
 * GET handler for listing all user field definitions.
 *
 * Requires authentication. Returns all field definitions (both code-sourced
 * and UI-sourced), ordered by sort order ascending.
 *
 * Response Codes:
 * - 200 OK: Field definitions list retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Failed to fetch field definitions
 *
 * Response: `{ "data": { "fields": UserFieldDefinition[], "adminConfig"?:
 * UsersAdminConfig } }`. Admin code reads `data.fields` and
 * `data.adminConfig` (spec §10.2 reserves `meta` for pagination only).
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/user-fields"
 * # => {"data":{"fields":[...],"adminConfig":{...}}}
 * ```
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await requireRouteAnyPermission(request, [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);

    const service = await getUserFieldDefinitionService();
    const fields = await service.listFields();

    // Read user admin config (listFields, group) from defineConfig().
    const config = container.get<NextlyServiceConfig>("config");
    const adminConfig = config?.users?.admin ?? undefined;

    return respondData({
      fields,
      ...(adminConfig && { adminConfig }),
    });
  }
);

/**
 * POST handler for creating a new user field definition.
 *
 * Requires authentication. Only UI-sourced fields can be created via API.
 * The `source` is automatically set to `'ui'`. Code-sourced fields are
 * managed via `defineConfig()` and synced on startup.
 *
 * Request Body: see `createFieldSchema` above for the full shape.
 *
 * Response Codes:
 * - 201 Created: Field definition created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 409 Conflict: Field name already exists
 * - 500 Internal Server Error: Creation failed
 *
 * Response: `{ "data": UserFieldDefinition }`; the created field. Status 201.
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await requireRouteAnyPermission(request, [
      { action: "create", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);

    const body = await readJsonBody(request);

    // Boot before parsing: the schema's `type` check consults the plugin
    // field-type registry, which is populated during first-request init. Parsing
    // first would reject a valid plugin field type on a cold start.
    const service = await getUserFieldDefinitionService();

    let validated: z.infer<typeof createFieldSchema>;
    try {
      validated = createFieldSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }
    // Force source to 'ui'; code-sourced fields are managed via defineConfig().
    const field = await service.createField({
      ...validated,
      source: "ui",
    });

    return respondMutation("User field created.", field, { status: 201 });
  }
);
