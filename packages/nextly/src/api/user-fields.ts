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
 * export { GET, POST } from '@revnixhq/nextly/api/user-fields';
 * ```
 *
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: <result> }` envelope per spec §10.2. The legacy
 * GET response carried both the field list and the user `adminConfig` in
 * `meta` — but spec §10.2 reserves `meta` for pagination only. The
 * canonical replacement is `{ data: { fields, adminConfig? } }` (same
 * structured-data pattern as api-keys.ts `createApiKey` returning
 * `{ data: { doc, key } }`). Validation flows through
 * `nextlyValidationFromZod` (F11).
 *
 * @module api/user-fields
 */

import { z } from "zod";

import { container } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getUserFieldDefinitionService(): Promise<UserFieldDefinitionService> {
  await getNextly();
  return container.get<UserFieldDefinitionService>(
    "userFieldDefinitionService"
  );
}

function requireAuthHeader(request: Request): void {
  if (!request.headers.get("Authorization")) {
    throw NextlyError.authRequired();
  }
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
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
}

const optionSchema = z.object({
  label: z.string().min(1, "Option label is required"),
  value: z.string().min(1, "Option value is required"),
});

const createFieldSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9]*$/,
      "Name must start with a letter and contain only alphanumeric characters"
    ),
  label: z.string().min(1, "Label is required").max(255),
  type: z.enum(
    [
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ],
    {
      message:
        "Type must be one of: text, textarea, number, email, select, radio, checkbox, date",
    }
  ),
  required: z.boolean().optional(),
  defaultValue: z.string().optional().nullable(),
  options: z.array(optionSchema).optional().nullable(),
  placeholder: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
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
 * UsersAdminConfig } }`. The structured-data shape replaces the legacy
 * `{ data: [...], meta: { total, ...adminConfig } }` because spec §10.2
 * reserves `meta` for pagination only — admin code must read
 * `data.fields` and `data.adminConfig` instead of `data` / `meta`.
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
    requireAuthHeader(request);

    const service = await getUserFieldDefinitionService();
    const fields = await service.listFields();

    // Read user admin config (listFields, group) from defineConfig().
    const config = container.get<NextlyServiceConfig>("config");
    const adminConfig = config?.users?.admin ?? undefined;

    return createSuccessResponse({
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
 * Response: `{ "data": UserFieldDefinition }` — created field. Status 201.
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const body = await readJsonBody(request);

    let validated: z.infer<typeof createFieldSchema>;
    try {
      validated = createFieldSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getUserFieldDefinitionService();
    // Force source to 'ui' — code-sourced fields are managed via defineConfig().
    const field = await service.createField({
      ...validated,
      source: "ui",
    });

    return createSuccessResponse(field, { status: 201 });
  }
);
