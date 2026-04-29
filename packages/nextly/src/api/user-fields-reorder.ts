/**
 * User Field Definitions Reorder API Route Handler for Next.js
 *
 * Updates the sort order of user field definitions based on an array of
 * field IDs in the desired order. Re-export in your Next.js application
 * at /api/user-fields/reorder.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/user-fields/reorder/route.ts
 * export { PATCH } from '@revnixhq/nextly/api/user-fields-reorder';
 * ```
 *
 * Wire shape — Task 21 migration: handler wraps `withErrorHandler` and
 * returns the canonical `{ data: <result> }` envelope per spec §10.2.
 *
 * @module api/user-fields-reorder
 */

import { z } from "zod";

import { container } from "../di";
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

const reorderSchema = z.object({
  fieldIds: z
    .array(z.string().min(1, "Field ID cannot be empty"))
    .min(1, "At least one field ID is required"),
});

/**
 * PATCH handler for reordering user field definitions.
 *
 * Requires authentication. Accepts an array of field IDs in the desired
 * display order. Each field's `sortOrder` is updated to match its position
 * in the array (0-indexed). Field IDs not in the array keep their current
 * sort order. The operation is atomic (uses a transaction).
 *
 * Request Body:
 * - fieldIds: Array of field definition IDs in desired order (required)
 *
 * Response Codes:
 * - 200 OK: Fields reordered successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Reorder failed
 *
 * Response: `{ "data": UserFieldDefinition[] }` — the updated field list
 * in the new order.
 */
export const PATCH = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

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

    let validated: z.infer<typeof reorderSchema>;
    try {
      validated = reorderSchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getUserFieldDefinitionService();
    const fields = await service.reorderFields(validated.fieldIds);

    return createSuccessResponse(fields);
  }
);
