/**
 * Components API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * component definition management endpoints at /api/components.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/components/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/components';
 * ```
 *
 * @module api/components
 */

import { z } from "zod";

import { getService } from "../di";
import { clampLimit } from "../domains/collections/query/query-parser";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { ComponentRegistryService } from "../services/components/component-registry-service";

import { respondList, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getCachedNextly();
  return getService("componentRegistryService");
}

const createComponentSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(255, "Slug must be 255 characters or less")
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Slug must start with a letter and contain only lowercase letters, numbers, and hyphens"
    ),
  label: z.string().min(1, "Label is required"),
  description: z.string().optional(),
  fields: z.array(z.any()), // Field validation is complex, handled by service
  admin: z
    .object({
      category: z.string().optional(),
      icon: z.string().optional(),
      hidden: z.boolean().optional(),
      description: z.string().optional(),
      imageURL: z.string().optional(),
    })
    .optional(),
});

/**
 * GET handler for listing components with pagination and filters.
 *
 * This is a public endpoint - no authentication required.
 * Used by Admin UI to load component list for navigation.
 *
 * Query Parameters:
 * - source: Filter by source type ("code" | "ui")
 * - search: Search query for slug and label
 * - limit: Maximum results (default: 50)
 * - offset: Number of results to skip (default: 0)
 *
 * Response Codes:
 * - 200 OK: Components list retrieved successfully
 * - 500 Internal Server Error: Failed to fetch components
 *
 * @param request - Next.js Request object
 * @returns Response with JSON component list and pagination meta
 *
 * @example
 * ```bash
 * curl "http://localhost:3000/api/components?source=ui&limit=10"
 * # => {"items":[...],"meta":{"total":5,"page":1,"limit":10,"totalPages":1,"hasNext":false,"hasPrev":false}}
 * ```
 */
export const GET = withErrorHandler(async (request: Request) => {
  const registry = await getComponentRegistry();
  const { searchParams } = new URL(request.url);

  const source = searchParams.get("source") as "code" | "ui" | null;
  const search = searchParams.get("search") || undefined;
  // Clamp `limit` to MAX_QUERY_LIMIT.
  const limit = clampLimit(searchParams.get("limit"), { defaultLimit: 50 });
  const offset = searchParams.get("offset")
    ? parseInt(searchParams.get("offset")!, 10)
    : 0;

  const result = await registry.listComponents({
    source: source || undefined,
    search,
    limit,
    offset,
  });

  // Translate offset-based pagination to the canonical page/limit meta
  // (spec §5.1). `safeLimit` is clamped to a minimum of 1 to keep the
  // page-derivation safe when the caller asks for `limit=0`.
  const safeLimit = Math.max(1, limit);
  const page = Math.floor(offset / safeLimit) + 1;
  const totalPages =
    result.total > 0 ? Math.ceil(result.total / safeLimit) : 0;
  return respondList(result.data, {
    total: result.total,
    page,
    limit: safeLimit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
});

/**
 * POST handler for creating a new UI component.
 *
 * Requires authentication. Creates a new component with source="ui" and locked=false.
 *
 * Request Body:
 * - slug: Unique identifier (lowercase, letters/numbers/hyphens)
 * - label: Display name for the component
 * - description: Optional description
 * - fields: Array of field configurations
 * - admin: Optional admin UI configuration (category, icon, hidden, description, imageURL)
 *
 * Response Codes:
 * - 201 Created: Component created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 409 Conflict: Component with slug already exists
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created component
 */
export const POST = withErrorHandler(async (request: Request) => {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    throw NextlyError.authRequired();
  }

  // TODO: Validate the auth token and extract user ID
  // For now, we accept any Authorization header as authenticated
  // In production, you would verify the JWT/session token here

  const registry = await getComponentRegistry();
  const body = await request.json();

  const parsed = createComponentSchema.safeParse(body);
  if (!parsed.success) {
    throw nextlyValidationFromZod(parsed.error);
  }
  const validated = parsed.data;

  // Generate table name from slug (comp_ prefix added by service)
  const tableName = validated.slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const schemaHash = calculateSchemaHash(validated.fields);

  const component = await registry.registerComponent({
    slug: validated.slug,
    label: validated.label,
    tableName,
    description: validated.description,
    fields: validated.fields,
    admin: validated.admin,
    source: "ui",
    locked: false,
    schemaHash,
  });

  return respondMutation("Component created.", component, { status: 201 });
});
