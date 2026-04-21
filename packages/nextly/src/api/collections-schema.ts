/**
 * Collection Schema API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * collection schema management endpoints at /api/collections/schema.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/collections/schema/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/collections-schema';
 * ```
 *
 * @module api/collections-schema
 */

import { z } from "zod";

import { getSession } from "../auth/session";
import { getService } from "../di";
import { computeFieldDiff } from "../domains/schema/services/field-diff";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { env } from "../lib/env";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import { hasPermission, isSuperAdmin } from "../services/lib/permissions";
import { simplePluralize } from "../shared/lib/pluralization";

async function getCollectionRegistry(): Promise<CollectionRegistryService> {
  await getNextly();
  return getService("collectionRegistryService");
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
  console.error(`[Collections Schema API] ${operation} error:`, error);

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

const createCollectionSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(255, "Slug must be 255 characters or less")
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Slug must start with a letter and contain only lowercase letters, numbers, and underscores"
    ),
  labels: z.object({
    singular: z.string().min(1, "Singular label is required"),
    plural: z.string().min(1, "Plural label is required").optional(),
  }),
  description: z.string().optional(),
  fields: z.array(z.any()), // Field validation is complex, handled by service
  timestamps: z.boolean().default(true),
  admin: z
    .object({
      group: z.string().optional(),
      icon: z.string().optional(),
      hidden: z.boolean().optional(),
      useAsTitle: z.string().optional(),
      isPlugin: z.boolean().optional(),
      order: z.number().optional(),
      sidebarGroup: z.string().optional(),
    })
    .optional(),
  hooks: z.array(z.any()).optional(),
});

/**
 * GET handler for listing collections with pagination and filters.
 *
 * Query Parameters:
 * - source: Filter by source type ("code" | "ui" | "built-in")
 * - search: Search query for slug and labels
 * - limit: Maximum results (default: 50)
 * - offset: Number of results to skip (default: 0)
 *
 * Response Codes:
 * - 200 OK: Collections list retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch collections
 *
 * Security:
 * - Returns only collections the user has read permission for
 * - Filters by user's capabilities before returning results
 * - Anonymous/unauthenticated users get empty list
 *
 * @param request - Next.js Request object
 * @returns Response with JSON collection list and pagination meta
 *
 * @example
 * ```bash
 * curl "http://localhost:3000/api/collections/schema?source=ui&limit=10"
 * # => {"data":[...],"meta":{"total":5,"limit":10,"offset":0}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    // Authenticate the request - required to filter by user permissions
    const sessionResult = await getSession(
      request,
      env.NEXTLY_SECRET_RESOLVED || ""
    );
    const user = sessionResult.authenticated ? sessionResult.user : null;
    if (!user) {
      return errorResponse("Authentication required", 401, "UNAUTHORIZED");
    }

    const registry = await getCollectionRegistry();
    const { searchParams } = new URL(request.url);

    const source = searchParams.get("source") as
      | "code"
      | "ui"
      | "built-in"
      | null;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : 50;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : 0;

    const result = await registry.listCollections({
      source: source || undefined,
      search,
      limit,
      offset,
    });

    // Super-admins get all collections; other users only get collections
    // they have explicit read-{slug} permission for.
    const isAdmin = await isSuperAdmin(user.id);
    let filteredCollections = result.data;

    if (!isAdmin) {
      const permittedCollections = [];

      for (const collection of result.data) {
        const collectionSlug = collection.slug;
        const canRead = await hasPermission(user.id, "read", collectionSlug);

        if (canRead) {
          permittedCollections.push(collection);
        }
      }

      filteredCollections = permittedCollections;
    }

    const filteredTotal = filteredCollections.length;

    return successResponse(filteredCollections, 200, {
      total: filteredTotal,
      limit,
      offset,
    });
  } catch (error) {
    return handleError(error, "List collections");
  }
}

/**
 * POST handler for creating a new UI collection.
 *
 * Requires authentication. Creates a new collection with source="ui" and locked=false.
 *
 * Request Body:
 * - slug: Unique identifier (lowercase, letters/numbers/underscores)
 * - labels: { singular: string, plural?: string } (plural auto-derived if omitted)
 * - description: Optional description
 * - fields: Array of field configurations
 * - timestamps: Whether to auto-add createdAt/updatedAt (default: true)
 * - admin: Optional admin UI configuration
 *
 * Response Codes:
 * - 201 Created: Collection created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 409 Conflict: Collection with slug already exists
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created collection
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/collections/schema', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     slug: 'blog_posts',
 *     labels: { singular: 'Blog Post', plural: 'Blog Posts' },
 *     fields: [
 *       { type: 'text', name: 'title', required: true },
 *       { type: 'richText', name: 'content' },
 *     ],
 *   }),
 * });
 * const { data: collection } = await response.json();
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // getSession returns GetSessionResult; extract user or null for backward compat
    const postResult = await getSession(
      request,
      env.NEXTLY_SECRET_RESOLVED || ""
    );
    const user = postResult.authenticated ? postResult.user : null;
    if (!user) {
      return errorResponse("Authentication required", 401, "UNAUTHORIZED");
    }

    // Initialize services (required for permission check via RBAC tables)
    const registry = await getCollectionRegistry();

    // Authorise: only super-admins or users with manage-settings permission
    // may create new collections (matches the frontend route guard).
    const isAdmin = await isSuperAdmin(user.id);
    if (!isAdmin) {
      const canManage = await hasPermission(user.id, "manage", "settings");
      if (!canManage) {
        return errorResponse(
          "Forbidden: you do not have permission to create collections",
          403,
          "FORBIDDEN"
        );
      }
    }
    const body = await request.json();

    const validated = createCollectionSchema.parse(body);

    const tableName = validated.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    // Calculate schema hash for change detection
    const schemaHash = calculateSchemaHash(validated.fields);

    const normalizedLabels = {
      singular: validated.labels.singular,
      plural:
        validated.labels.plural?.trim() ||
        simplePluralize(validated.labels.singular),
    };

    const collection = await registry.registerCollection({
      slug: validated.slug,
      labels: normalizedLabels,
      tableName,
      description: validated.description,
      fields: validated.fields,
      timestamps: validated.timestamps,
      admin: validated.admin,
      source: "ui",
      locked: false,
      schemaHash,
      hooks: validated.hooks,
    });

    return successResponse(collection, 201);
  } catch (error) {
    return handleError(error, "Create collection");
  }
}

// NOTE: previewSchemaChanges and applySchemaChanges were previously defined here
// as orphaned functions (no route handler pointed to them). They have been replaced
// by the SchemaChangeService, which is called via the dispatcher:
//   POST /api/collections/schema/{slug}/preview -> dispatcher -> SchemaChangeService.preview()
//   POST /api/collections/schema/{slug}/apply   -> dispatcher -> SchemaChangeService.apply()
