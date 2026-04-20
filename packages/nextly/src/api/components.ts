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
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { ComponentRegistryService } from "../services/components/component-registry-service";

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getNextly();
  return getService("componentRegistryService");
}

function successResponse<T>(
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>
): Response {
  return Response.json(
    {
      data,
      ...(meta && { meta }),
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function errorResponse(
  message: string,
  statusCode: number = 500,
  code?: string
): Response {
  return Response.json(
    {
      error: {
        message,
        ...(code && { code }),
      },
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function handleError(error: unknown, operation: string): Response {
  console.error(`[Components API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof z.ZodError) {
    const firstError = error.issues[0];
    return errorResponse(
      firstError?.message || "Validation error",
      400,
      "VALIDATION_ERROR"
    );
  }

  if (error instanceof Error) {
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503, "SERVICE_UNAVAILABLE");
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
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
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch components
 *
 * @param request - Next.js Request object
 * @returns Response with JSON component list and pagination meta
 *
 * @example
 * ```bash
 * curl "http://localhost:3000/api/components?source=ui&limit=10"
 * # => {"data":[...],"meta":{"total":5,"limit":10,"offset":0}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const registry = await getComponentRegistry();
    const { searchParams } = new URL(request.url);

    const source = searchParams.get("source") as "code" | "ui" | null;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : 50;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : 0;

    const result = await registry.listComponents({
      source: source || undefined,
      search,
      limit,
      offset,
    });

    return successResponse(result.data, 200, {
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    return handleError(error, "List components");
  }
}

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
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created component
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/components', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     slug: 'seo',
 *     label: 'SEO Metadata',
 *     fields: [
 *       { type: 'text', name: 'metaTitle', required: true },
 *       { type: 'text', name: 'metaDescription' },
 *     ],
 *     admin: {
 *       category: 'Shared',
 *       icon: 'Search',
 *     },
 *   }),
 * });
 * const { data: component } = await response.json();
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Authentication required", 401, "UNAUTHORIZED");
    }

    // TODO: Validate the auth token and extract user ID
    // For now, we accept any Authorization header as authenticated
    // In production, you would verify the JWT/session token here

    const registry = await getComponentRegistry();
    const body = await request.json();

    const validated = createComponentSchema.parse(body);

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

    return successResponse(component, 201);
  } catch (error) {
    return handleError(error, "Create component");
  }
}
