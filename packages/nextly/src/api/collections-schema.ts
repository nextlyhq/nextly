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
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import { hasPermission, isSuperAdmin } from "../services/lib/permissions";
import { simplePluralize } from "../shared/lib/pluralization";

import { respondList, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getCollectionRegistry(): Promise<CollectionRegistryService> {
  await getCachedNextly();
  return getService("collectionRegistryService");
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
    singular: z.string().trim().min(1, "Singular label is required"),
    plural: z.string().trim().min(1, "Plural label is required").optional(),
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

async function requireUser(request: Request): Promise<{ id: string }> {
  // getSession returns GetSessionResult; extract user or throw the unified
  // auth-required error so the boundary returns canonical 401.
  const result = await getSession(request, env.NEXTLY_SECRET_RESOLVED || "");
  const user = result.authenticated ? result.user : null;
  if (!user) {
    throw NextlyError.authRequired();
  }
  return { id: user.id };
}

/**
 * GET handler for listing collections with pagination and filters.
 *
 * Returns only collections the caller has read permission for; super-admins
 * see everything. Anonymous callers get 401.
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
 * - 500 Internal Server Error: Failed to fetch collections
 *
 * @example
 * ```bash
 * curl "http://localhost:3000/api/collections/schema?source=ui&limit=10"
 * # => {"items":[...],"meta":{"total":5,"page":1,"limit":10,"totalPages":1,"hasNext":false,"hasPrev":false}}
 * ```
 */
export const GET = withErrorHandler(async (request: Request) => {
  const user = await requireUser(request);

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

  // Translate offset-based pagination to the canonical page/limit meta. The
  // total reflects the post-permission-filter count so non-admins see a
  // total consistent with what they can paginate through.
  const safeLimit = Math.max(1, limit);
  const page = Math.floor(offset / safeLimit) + 1;
  const total = filteredCollections.length;
  const totalPages = Math.ceil(total / safeLimit);
  return respondList(filteredCollections, {
    total,
    page,
    limit: safeLimit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
});

/**
 * POST handler for creating a new UI collection.
 *
 * Requires super-admin or `manage-settings` permission. Creates a new
 * collection with `source="ui"` and `locked=false`.
 *
 * Response Codes:
 * - 201 Created: Collection created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Caller lacks permission to create collections
 * - 409 Conflict: Collection with slug already exists
 * - 500 Internal Server Error: Creation failed
 */
export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser(request);

  // Initialize services (required for permission check via RBAC tables).
  const registry = await getCollectionRegistry();

  // Authorise: only super-admins or users with manage-settings permission
  // may create new collections (matches the frontend route guard). The
  // legacy public message included context; per spec §13.8 the canonical
  // forbidden message is generic and the operator detail goes to logs.
  const isAdmin = await isSuperAdmin(user.id);
  if (!isAdmin) {
    const canManage = await hasPermission(user.id, "manage", "settings");
    if (!canManage) {
      throw NextlyError.forbidden({
        logContext: {
          userId: user.id,
          required: "manage-settings",
          operation: "create-collection",
        },
      });
    }
  }

  const body = await request.json();

  const parseResult = createCollectionSchema.safeParse(body);
  if (!parseResult.success) {
    throw nextlyValidationFromZod(parseResult.error);
  }
  const validated = parseResult.data;

  const tableName = validated.slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  // Calculate schema hash for change detection.
  const schemaHash = calculateSchemaHash(validated.fields);

  const normalizedLabels = {
    singular: validated.labels.singular.trim(),
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

  // POST is a create; canonical mutation envelope ships a toast message
  // alongside the new collection so the admin can confirm success.
  return respondMutation("Collection created.", collection, { status: 201 });
});

// NOTE: previewSchemaChanges and applySchemaChanges live in the
// dispatcher (collection-dispatcher.ts). Wire-routes:
//   POST /api/collections/schema/{slug}/preview -> dispatcher.previewSchemaChanges()
//     -> pipeline/preview.ts (diff + classify)
//     -> legacy-preview/translate.ts (legacy SchemaPreviewResult shape)
//   POST /api/collections/schema/{slug}/apply -> dispatcher.applySchemaChanges()
//     -> applyDesiredSchema (full pipeline including pre-cleanup + pushSchema)
