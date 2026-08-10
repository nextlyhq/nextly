/**
 * Field Groups API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * component definition management endpoints at /api/field-groups.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/field-groups/route.ts
 * export { GET, POST } from 'nextly/api/field-groups';
 * ```
 *
 * @module api/field-groups
 */

import { z } from "zod";

import { getService } from "../di";
import { clampLimit } from "../domains/collections/query/query-parser";
import type {
  CreateFieldGroupInput,
  FieldGroupMetadataService,
} from "../domains/field-groups/services/field-group-metadata-service";
import { MAX_FIELD_GROUP_SLUG_LENGTH } from "../domains/field-groups/services/field-group-schema-service";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { resolveComponentTableName } from "../domains/schema/utils/resolve-table-name";
import { getCachedNextly } from "../init";
import type { FieldGroupRegistryService } from "../services/field-groups/field-group-registry-service";
import { requireBuilderEnabled } from "../shared/builder-access";

import { assertValidFieldsPayload } from "./fields-payload";
import { respondList, respondMutation } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getComponentRegistry(): Promise<FieldGroupRegistryService> {
  await getCachedNextly();
  return getService("fieldGroupRegistryService");
}

/**
 * The service that owns a field group's table and its registry row together.
 *
 * This route used to call the registry directly, which wrote the row and made no table: it answered
 * 201 for a field group whose `comp_<slug>` did not exist, and every later read and write to it
 * failed against the database.
 */
async function getFieldGroupMetadataService(): Promise<FieldGroupMetadataService> {
  await getCachedNextly();
  return getService("fieldGroupMetadataService");
}

const createComponentSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    // Bounded by the longest IDENTIFIER a field group generates, not by the slug itself and not by
    // any column width. The slug is prefixed into a table name and that table name is prefixed and
    // suffixed into `idx_comp_<slug>_parent`, sixteen characters longer than what the caller typed.
    // The product's usual 50 therefore still yields a 66-character index name: MySQL rejects past
    // 64, and PostgreSQL silently truncates past 63 — leaving an index under a name nothing can
    // address. Accepted here, the table is created and the index creation fails, so the field group
    // is recorded failed with an unbound table and the route still answers 201.
    .max(
      MAX_FIELD_GROUP_SLUG_LENGTH,
      `Slug must be ${MAX_FIELD_GROUP_SLUG_LENGTH} characters or less`
    )
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Slug must start with a letter and contain only lowercase letters, numbers, and hyphens"
    ),
  label: z.string().min(1, "Label is required"),
  description: z.string().optional(),
  // Validated against the shared manifest field rules after parse (see
  // api/fields-payload); kept unknown here so passthrough keys survive.
  fields: z.array(z.unknown()),
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
 * Requires read-settings (or manage-settings), matching the dispatcher's
 * components authorization — component definitions are builder-surface
 * metadata, not public content.
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
 * curl "http://localhost:3000/api/field-groups?source=ui&limit=10"
 * # => {"items":[...],"meta":{"total":5,"page":1,"limit":10,"totalPages":1,"hasNext":false,"hasPrev":false}}
 * ```
 */
export const GET = withErrorHandler(async (request: Request) => {
  // Boot services before the permission check: the RBAC/API-key path resolves
  // through the DI adapter, which is registered lazily on the first request.
  // Gating first would make the permission lookup fail closed (403/503) before
  // init runs, breaking the documented auto-initialization on first request.
  const registry = await getComponentRegistry();

  await requireRouteAnyPermission(request, [
    { action: "read", resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);

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
  const totalPages = result.total > 0 ? Math.ceil(result.total / safeLimit) : 0;
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
 * Requires create-settings (or manage-settings), matching the dispatcher's
 * components authorization. Creates a new component with source="ui" and
 * locked=false.
 *
 * Request Body:
 * - slug: Unique identifier (lowercase, letters/numbers/hyphens)
 * - label: Display name for the component
 * - description: Optional description
 * - fields: Array of field configurations
 * - admin: Optional admin UI configuration (category, icon, hidden, description, imageURL)
 *
 * Response Codes:
 * - 201 Created: Field group created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 409 Conflict: Component with slug already exists
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created component
 */
export const POST = withErrorHandler(async (request: Request) => {
  // Schema DDL: refuse when the builder is disabled for this environment.
  requireBuilderEnabled("create-component");

  // Boot services before the permission check (see GET) so lazy DI init does
  // not turn a valid caller's first request into a 403/503.
  const metadata = await getFieldGroupMetadataService();

  await requireRouteAnyPermission(request, [
    { action: "create", resource: "settings" },
    { action: "manage", resource: "settings" },
  ]);

  const body = await request.json();

  const parsed = createComponentSchema.safeParse(body);
  if (!parsed.success) {
    throw nextlyValidationFromZod(parsed.error);
  }
  const validated = parsed.data;

  // Same rules as the ui-schema.json mirror (see api/fields-payload).
  assertValidFieldsPayload(validated.fields);

  // Generate table name from slug (comp_ prefix added by service)
  // Canonical name derivation (comp_ + normalized slug), matching the
  // registry sync and dispatcher paths, so the stored registry row and the
  // physical table always agree.
  const tableName = resolveComponentTableName(validated.slug);

  // Validated by assertValidFieldsPayload above; cast through `unknown`
  // to the registry's config type while keeping the payload unstripped.
  const fields = validated.fields as unknown as CreateFieldGroupInput["fields"];

  const schemaHash = calculateSchemaHash(fields);

  const { record, migrationStatus } = await metadata.createFieldGroup({
    slug: validated.slug,
    label: validated.label,
    tableName,
    description: validated.description,
    fields,
    admin: validated.admin,
    source: "ui",
    locked: false,
    schemaHash,
  });

  // The status is reported rather than swallowed. A create whose DDL failed still has a row
  // describing what was attempted, and answering an unqualified success for it is what let a field
  // group with no table look healthy.
  const message =
    migrationStatus === "applied"
      ? "Field group created."
      : "Field group created, but its table could not be provisioned. Check the server logs and retry.";

  return respondMutation(message, record, { status: 201 });
});
