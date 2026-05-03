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
 * Wire shape (Phase 4 envelope migration): handlers wrap `withErrorHandler`
 * and return canonical `respondX` envelopes per spec §5.1 (bare doc on GET,
 * `{ message, item }` on PATCH, 204 on DELETE). Errors serialize as
 * `application/problem+json`. The legacy route-layer `FORBIDDEN to LOCKED`
 * remap is dropped; the registry now throws `NextlyError.forbidden` with the
 * `collection-locked` reason in `logContext`, and the wire surface stays
 * canonical FORBIDDEN.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/collections/schema/[slug]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/collections-schema-detail';
 * ```
 *
 * @module api/collections-schema-detail
 */

import type { FieldConfig } from "@nextly/collections";

import { getSession } from "../auth/session";
import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import { getNextlyLogger } from "../observability/logger";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import type { ComponentRegistryService } from "../services/components/component-registry-service";
import { hasPermission, isSuperAdmin } from "../services/lib/permissions";
import { simplePluralize } from "../shared/lib/pluralization";

import { respondDoc, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getCollectionRegistry(): Promise<CollectionRegistryService> {
  await getCachedNextly();
  return getService("collectionRegistryService");
}

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getCachedNextly();
  return getService("componentRegistryService");
}

async function requireUser(request: Request): Promise<{ id: string }> {
  // getSession returns GetSessionResult; throw the unified auth-required
  // error so the boundary returns canonical 401.
  const result = await getSession(request, env.NEXTLY_SECRET_RESOLVED || "");
  const user = result.authenticated ? result.user : null;
  if (!user) {
    throw NextlyError.authRequired();
  }
  return { id: user.id };
}

/**
 * Authorize a non-superadmin caller for the management surface (PATCH/DELETE).
 * Identifiers and required-permission detail are kept out of the public
 * message per spec §13.8 and surfaced through `logContext`.
 */
async function requireManageSettings(userId: string): Promise<void> {
  if (await isSuperAdmin(userId)) return;
  const canManage = await hasPermission(userId, "manage", "settings");
  if (!canManage) {
    throw NextlyError.forbidden({
      logContext: {
        userId,
        required: "manage-settings",
        operation: "manage-collection",
      },
    });
  }
}

/**
 * GET handler for retrieving a single collection by slug.
 *
 * Requires authentication and read permission for the collection. The
 * registry throws `NOT_FOUND` if no collection matches the slug.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const user = await requireUser(request);
    const { slug } = await context.params;

    const isAdmin = await isSuperAdmin(user.id);
    if (!isAdmin) {
      const canRead = await hasPermission(user.id, "read", slug);
      if (!canRead) {
        throw NextlyError.forbidden({
          logContext: {
            userId: user.id,
            required: `read-${slug}`,
            operation: "read-collection",
          },
        });
      }
    }

    const registry = await getCollectionRegistry();
    const collection = await registry.getCollection(slug);

    // Enrich component fields with inline schemas for Admin UI so form
    // rendering doesn't need extra API calls per component. If the component
    // registry is unavailable we fall back to the raw fields rather than
    // failing the whole request.
    let enrichedFields: Record<string, unknown>[] =
      collection.fields as unknown as Record<string, unknown>[];
    try {
      const componentRegistry = await getComponentRegistry();
      enrichedFields = await componentRegistry.enrichFieldsWithComponentSchemas(
        collection.fields as unknown as Record<string, unknown>[]
      );
    } catch (enrichError) {
      // Best-effort enrichment: surface the failure through the unified
      // observability seam (the boundary won't see it because we swallow
      // it on purpose to keep the GET responsive with raw fields).
      getNextlyLogger().warn({
        kind: "collection-schema-enrichment-failed",
        slug,
        err: String(enrichError),
      });
    }

    return respondDoc({
      ...collection,
      fields: enrichedFields,
    } as unknown as typeof collection);
  }
);

/**
 * PATCH handler for updating a collection.
 *
 * Requires `manage-settings` (or super-admin). The registry throws
 * `NextlyError.forbidden` with `reason: "collection-locked"` if the
 * collection is locked (code-first collections cannot be modified via API).
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    // Initialize services first so the permission cache / DB is ready
    const registry = await getCollectionRegistry();

    const user = await requireUser(request);
    await requireManageSettings(user.id);

    const { slug } = await context.params;

    // Body parse failure is a client error — surface as a single-issue
    // validation rather than letting the SyntaxError become a 500.
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw NextlyError.validation({
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      });
    }

    const updateData: Record<string, unknown> = {};

    if (body.labels !== undefined) {
      const labels = body.labels as {
        singular?: string;
        plural?: string;
      };

      if (labels.singular !== undefined) {
        const singular = labels.singular.trim();
        updateData.labels = {
          singular,
          plural: labels.plural?.trim() || simplePluralize(singular),
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
      // The registry re-validates the field config; cast through `unknown`
      // to avoid `any` while keeping the existing trust boundary.
      updateData.schemaHash = calculateSchemaHash(
        body.fields as unknown as FieldConfig[]
      );
    }

    if (body.timestamps !== undefined) {
      updateData.timestamps = body.timestamps;
    }

    // Admin fields: support both nested admin object and flat top-level
    // fields. The registry's updateCollection expects data.admin as a merged
    // object, so when any admin override is present we fetch the existing
    // collection and merge.
    const ADMIN_KEYS = [
      "icon",
      "group",
      "order",
      "sidebarGroup",
      "hidden",
      "useAsTitle",
      "defaultColumns",
    ] as const;

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

    // Update endpoint: canonical mutation envelope so consumers receive a
    // server-authored toast message alongside the refreshed collection.
    return respondMutation("Collection updated.", updated);
  }
);

/**
 * DELETE handler for removing a collection.
 *
 * Requires `manage-settings` (or super-admin). The registry throws
 * `NextlyError.forbidden` with `reason: "collection-locked-delete"` if the
 * collection is locked (code-first collections cannot be deleted via API).
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    // Initialize services first so the permission cache / DB is ready
    const registry = await getCollectionRegistry();

    const user = await requireUser(request);
    await requireManageSettings(user.id);

    const { slug } = await context.params;

    await registry.deleteCollection(slug);

    return new Response(null, { status: 204 });
  }
);
