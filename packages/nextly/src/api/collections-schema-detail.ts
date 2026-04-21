/**
 * Collection Schema Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual collection management endpoints at /api/collections/schema/[slug].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/collections/schema/[slug]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/collections-schema-detail';
 * ```
 *
 * @module api/collections-schema-detail
 */

import { getSession } from "../auth/session";
import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { env } from "../lib/env";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import type { ComponentRegistryService } from "../services/components/component-registry-service";
import { hasPermission, isSuperAdmin } from "../services/lib/permissions";
import { simplePluralize } from "../shared/lib/pluralization";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getCollectionRegistry(): Promise<CollectionRegistryService> {
  await getNextly();
  return getService("collectionRegistryService");
}

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getNextly();
  return getService("componentRegistryService");
}

function successResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json(
    { data },
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
  console.error(`[Collections Schema Detail API] ${operation} error:`, error);

  if (isServiceError(error)) {
    // Map FORBIDDEN to LOCKED for locked collection errors
    const code = error.code === "FORBIDDEN" ? "LOCKED" : error.code;
    return errorResponse(error.message, error.httpStatus, code);
  }

  if (error instanceof Error) {
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503, "SERVICE_UNAVAILABLE");
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

async function requireAuth(
  request: Request
): Promise<import("../auth/session").SessionUser | Response> {
  // getSession returns GetSessionResult; extract user or null for backward compat
  const result = await getSession(request, env.NEXTLY_SECRET_RESOLVED || "");
  const user = result.authenticated ? result.user : null;
  if (!user) {
    return errorResponse("Authentication required", 401, "UNAUTHORIZED");
  }
  return user;
}

async function requireManageSettings(
  request: Request
): Promise<import("../auth/session").SessionUser | Response> {
  const userOrError = await requireAuth(request);
  if (userOrError instanceof Response) return userOrError;

  const user = userOrError;
  const isAdmin = await isSuperAdmin(user.id);
  if (!isAdmin) {
    const canManage = await hasPermission(user.id, "manage", "settings");
    if (!canManage) {
      return errorResponse(
        "Forbidden: you do not have permission to manage collections",
        403,
        "FORBIDDEN"
      );
    }
  }
  return user;
}

/**
 * GET handler for retrieving a single collection by slug.
 *
 * Requires authentication and read permission for the collection.
 *
 * Response Codes:
 * - 200 OK: Collection retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: User does not have read permission for this collection
 * - 404 Not Found: Collection with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch collection
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON collection data
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/collections/schema/blog_posts"
 * # => {"data":{"slug":"blog_posts","labels":{...},"fields":[...],...}}
 * ```
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const userOrError = await requireAuth(request);
    if (userOrError instanceof Response) return userOrError;

    const user = userOrError;
    const { slug } = await context.params;

    const isAdmin = await isSuperAdmin(user.id);
    if (!isAdmin) {
      const canRead = await hasPermission(user.id, "read", slug);
      if (!canRead) {
        return errorResponse(
          `Forbidden: you do not have read permission for collection '${slug}'`,
          403,
          "FORBIDDEN"
        );
      }
    }

    const registry = await getCollectionRegistry();
    const collection = await registry.getCollection(slug);

    // Enrich component fields with inline schemas for Admin UI
    // This allows form rendering without extra API calls per component
    // Type is Record<string, unknown>[] to allow EnrichedFieldConfig properties
    let enrichedFields: Record<string, unknown>[] =
      collection.fields as unknown as Record<string, unknown>[];
    try {
      const componentRegistry = await getComponentRegistry();
      enrichedFields = await componentRegistry.enrichFieldsWithComponentSchemas(
        collection.fields as unknown as Record<string, unknown>[]
      );
    } catch (enrichError) {
      // Log but don't fail — return unenriched fields if component registry unavailable
      console.warn(
        "[Collections Schema Detail API] Failed to enrich component fields:",
        enrichError
      );
    }

    // Cast through unknown to allow Record<string, unknown>[] in place of FieldConfig[]
    return successResponse({
      ...collection,
      fields: enrichedFields,
    } as unknown as typeof collection);
  } catch (error) {
    return handleError(error, "Get collection");
  }
}

/**
 * PATCH handler for updating a collection.
 *
 * Requires authentication. Returns 403 Forbidden if collection is locked
 * (code-first collections cannot be modified via API).
 *
 * Request Body (all fields optional):
 * - labels: { singular: string, plural?: string } (plural auto-derived if omitted)
 * - description: string
 * - fields: Array of field configurations
 * - timestamps: boolean
 * - admin: Admin UI configuration object
 *
 * Response Codes:
 * - 200 OK: Collection updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Collection is locked (code-first)
 * - 404 Not Found: Collection with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON updated collection
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/collections/schema/blog_posts', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     labels: { singular: 'Article', plural: 'Articles' },
 *     fields: [...updatedFields],
 *   }),
 * });
 * const { data: updated } = await response.json();
 * ```
 */
export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // Initialize services first so the permission cache / DB is ready
    const registry = await getCollectionRegistry();

    const userOrError = await requireManageSettings(request);
    if (userOrError instanceof Response) return userOrError;

    const { slug } = await context.params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const updateData: Record<string, unknown> = {};

    if (body.labels !== undefined) {
      const labels = body.labels as {
        singular?: string;
        plural?: string;
      };

      if (labels.singular !== undefined) {
        updateData.labels = {
          singular: labels.singular,
          plural: labels.plural?.trim() || simplePluralize(labels.singular),
        };
      } else {
        updateData.labels = labels;
      }
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (body.fields !== undefined) {
      updateData.fields = body.fields;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateData.schemaHash = calculateSchemaHash(body.fields as any);
    }

    if (body.timestamps !== undefined) {
      updateData.timestamps = body.timestamps;
    }

    // Admin fields: support both nested admin object and flat top-level fields.
    // CollectionRegistryService.updateCollection expects data.admin as a merged object.
    // We fetch the existing collection to merge admin fields properly.
    const ADMIN_KEYS = [
      "icon",
      "group",
      "order",
      "sidebarGroup",
      "hidden",
      "useAsTitle",
    ] as const;

    // Collect admin field overrides from both nested admin object and flat top-level fields
    const adminOverrides: Record<string, unknown> = {};
    if (body.admin !== undefined) {
      const admin = body.admin as Record<string, unknown>;
      for (const key of ADMIN_KEYS) {
        if (admin[key] !== undefined) {
          adminOverrides[key] = admin[key];
        }
      }
    }
    // Flat top-level fields take precedence over nested admin fields
    for (const key of ADMIN_KEYS) {
      if (body[key] !== undefined) {
        adminOverrides[key] = body[key];
      }
    }

    if (Object.keys(adminOverrides).length > 0) {
      const existing = await registry.getCollection(slug);
      updateData.admin = {
        ...(existing.admin || {}),
        ...adminOverrides,
      };
    }

    if (body.hooks !== undefined) {
      updateData.hooks = body.hooks;
    }

    // Update collection (source: "ui" to enforce locking rules)
    const updated = await registry.updateCollection(slug, updateData, {
      source: "ui",
    });

    return successResponse(updated);
  } catch (error) {
    return handleError(error, "Update collection");
  }
}

/**
 * DELETE handler for removing a collection.
 *
 * Requires authentication. Returns 403 Forbidden if collection is locked
 * (code-first collections cannot be deleted via API).
 *
 * Response Codes:
 * - 204 No Content: Collection deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Collection is locked (code-first)
 * - 404 Not Found: Collection with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Empty response with 204 status on success
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/collections/schema/blog_posts', {
 *   method: 'DELETE',
 *   headers: {
 *     'Authorization': 'Bearer <token>',
 *   },
 * });
 * // response.status === 204 on success
 * ```
 */
export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // Initialize services first so the permission cache / DB is ready
    const registry = await getCollectionRegistry();

    const userOrError = await requireManageSettings(request);
    if (userOrError instanceof Response) return userOrError;

    const { slug } = await context.params;

    await registry.deleteCollection(slug);

    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error, "Delete collection");
  }
}
