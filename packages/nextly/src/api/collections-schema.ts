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
 * export { GET, POST } from 'nextly/api/collections-schema';
 * ```
 *
 * @module api/collections-schema
 */

import { z } from "zod";

import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { resolveVersionsConfig } from "../domains/versions/resolve-config";
import { getFilterRegistry, FilterSeams } from "../filters";
import { getCachedNextly } from "../init";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import { hasPermission, isSuperAdmin } from "../services/lib/permissions";
import { requireBuilderEnabled } from "../shared/builder-access";
import { simplePluralize } from "../shared/lib/pluralization";

import { assertValidFieldsPayload } from "./fields-payload";
import { respondList, respondMutation } from "./response-shapes";
import {
  requireRouteAuthentication,
  requireRoutePermission,
} from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/**
 * @experimental D63 `admin.nav` filter seam. Lets plugins transform the
 * collection list that feeds the admin sidebar (hide/reorder/relabel).
 */
export async function applyAdminNavFilter<T extends { slug: string }>(
  items: T[],
  userId: string
): Promise<T[]> {
  return getFilterRegistry().applyFilters(FilterSeams.AdminNav, items, {
    userId,
  });
}

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
  // Validated against the shared manifest field rules after parse (see
  // api/fields-payload); kept unknown here so passthrough keys survive.
  fields: z.array(z.unknown()),
  timestamps: z.boolean().default(true),
  // Draft/Published opt-in. Default false keeps the existing public API
  // contract — collections without the flag continue to ship a single
  // Save/Create button.
  status: z.boolean().optional(),
  // i18n opt-in. Default false keeps non-localized behavior. Enabling adds the
  // companion `_locales` table on the next migrate (migration-gated).
  localized: z.boolean().optional(),
  // Version history opt-in. Default off: capture adds a row to nextly_versions
  // on every save, which no existing caller has asked for.
  versions: z.boolean().optional(),
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
  const auth = await requireRouteAuthentication(request);

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

  // Filter to the collections the caller may read. The authorization
  // MUST honor the authentication method: an API key carries its own
  // pre-resolved, possibly-narrowed permission set, so authorizing it via
  // the owner's session RBAC (`hasPermission`/`isSuperAdmin` by user id)
  // would let a restricted key list collections outside its scope. This
  // mirrors how `requirePermission` branches on `authMethod`.
  let filteredCollections = result.data;

  if (auth.authMethod === "api-key") {
    // The key's resolved permission set is the source of truth (no
    // super-admin bypass — that is already reflected in the resolved set).
    filteredCollections = result.data.filter(collection =>
      auth.permissions.includes(`read-${collection.slug}`)
    );
  } else {
    // Session auth: super-admins see everything; others need explicit
    // read-{slug} permission via their RBAC roles.
    const isAdmin = await isSuperAdmin(auth.userId);
    if (!isAdmin) {
      const permittedCollections = [];
      for (const collection of result.data) {
        const canRead = await hasPermission(
          auth.userId,
          "read",
          collection.slug
        );
        if (canRead) {
          permittedCollections.push(collection);
        }
      }
      filteredCollections = permittedCollections;
    }
  }

  // D63 seam: let plugins transform the admin nav collection list.
  const navItems = await applyAdminNavFilter(filteredCollections, auth.userId);

  // Translate offset-based pagination to the canonical page/limit meta. The
  // total reflects the post-permission-filter count so non-admins see a
  // total consistent with what they can paginate through.
  const safeLimit = Math.max(1, limit);
  const page = Math.floor(offset / safeLimit) + 1;
  const total = navItems.length;
  const totalPages = Math.ceil(total / safeLimit);
  return respondList(navItems, {
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
  // Creating a collection is DDL. Refuse before auth so a disabled builder
  // reads the same to every caller, super-admin or not.
  requireBuilderEnabled("create-collection");

  // Initialize services (required for permission check via RBAC tables).
  const registry = await getCollectionRegistry();

  // Authorise: only super-admins or users with manage-settings permission
  // may create new collections (matches the frontend route guard).
  await requireRoutePermission(request, "manage", "settings");

  const body = await request.json();

  const parseResult = createCollectionSchema.safeParse(body);
  if (!parseResult.success) {
    throw nextlyValidationFromZod(parseResult.error);
  }
  const validated = parseResult.data;

  // Same rules as the ui-schema.json mirror (see api/fields-payload).
  assertValidFieldsPayload(validated.fields, { kind: "collection" });

  const tableName = validated.slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  // Validated by assertValidFieldsPayload above; cast through `unknown`
  // to the registry's config type while keeping the payload unstripped.
  const fields = validated.fields as unknown as Parameters<
    typeof registry.registerCollection
  >[0]["fields"];

  // Calculate schema hash for change detection.
  const schemaHash = calculateSchemaHash(fields);

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
    fields,
    timestamps: validated.timestamps,
    admin: validated.admin,
    source: "ui",
    locked: false,
    // Forward Draft/Published flag so the schema-level POST honours the
    // user's status opt-in just like the dispatcher path does.
    status: validated.status === true,
    // i18n: forward the localization opt-in so the registry stores it (companion
    // table is provisioned on the next migrate).
    localized: validated.localized === true,
    // Version history opt-in, normalized to the resolved config the column
    // holds and every runtime reader tests.
    versions: resolveVersionsConfig(validated.versions),
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
