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
 * Locked code-first collections surface as canonical FORBIDDEN: the registry
 * throws `NextlyError.forbidden` with the `collection-locked` reason in
 * `logContext`.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/collections/schema/[slug]/route.ts
 * export { GET, PATCH, DELETE } from 'nextly/api/collections-schema-detail';
 * ```
 *
 * @module api/collections-schema-detail
 */

import type { FieldConfig } from "@nextly/collections";

import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import {
  coerceBuilderMaxPerDoc,
  resolveBuilderVersions,
} from "../domains/versions/builder-versions";
import {
  draftSplitResponseFields,
  schemaDraftSplit,
} from "../domains/versions/draft-split-eligibility";
import { resolveBuilderWebhooks } from "../domains/webhooks/builder-webhooks";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getNextlyLogger } from "../observability/logger";
import {
  applyPluginAdminViews,
  type CollectionWithAdmin,
} from "../plugins/admin-views";
import { resolveBuilderRevalidate } from "../revalidation/builder-revalidate";
import { getHandlerConfig } from "../route-handler/auth-handler";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import type { FieldGroupRegistryService } from "../services/field-groups/field-group-registry-service";
import { requireBuilderEnabled } from "../shared/builder-access";
import { simplePluralize } from "../shared/lib/pluralization";

import { assertValidFieldsPayload } from "./fields-payload";
import { respondDoc, respondMutation } from "./response-shapes";
import {
  requireRouteCollectionAccess,
  requireRoutePermission,
} from "./route-auth";
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

async function getComponentRegistry(): Promise<FieldGroupRegistryService> {
  await getCachedNextly();
  return getService("fieldGroupRegistryService");
}

/**
 * GET handler for retrieving a single collection by slug.
 *
 * Requires a verified session or API key with read access to the
 * collection, matching the dispatcher's `getCollection` authorization. The
 * registry throws `NOT_FOUND` if no collection matches the slug.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { slug } = await context.params;
    await requireRouteCollectionAccess(request, "read", slug);

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

    // Fold plugin-contributed view overrides (contributes.admin.views, D23)
    // onto this collection's admin.components so the existing client resolution
    // (Edit/List + before/after injection) renders them. Collection/Builder
    // slots win; plugin views fill empties only.
    const config = getHandlerConfig();
    const [collectionWithViews] = applyPluginAdminViews(
      [collection as unknown as CollectionWithAdmin],
      config?.plugins ?? []
    );

    // Derived flag: whether the draft/published working-draft split will actually
    // run for this collection. The admin editor reads it to decide whether a
    // "Save" stores a working draft or writes the live row, so it is derived from
    // the SAME shared predicate the mutation service gates on — a mismatch would
    // make the editor present a status-less save as a pending draft while the
    // server writes it live. Resolution runs over the ORIGINAL fields (not the
    // enriched ones, which drop the component localized/resolved markers).
    //
    // A resolution failure is propagated, not defaulted to false: for a
    // drafts-configured collection false is the destructive answer — the admin
    // would send an explicit published save that overwrites the live row instead
    // of storing a working draft — so this independently exported GET fails
    // closed and is retryable, matching the dispatcher path and the fail-closed
    // resolveComponentSchemas it calls into.
    const draftSplit = await schemaDraftSplit({
      status: (collection as { status?: boolean }).status,
      versions: collection.versions,
      fields: collection.fields,
      slug: (collection as { slug?: string }).slug,
    });

    return respondDoc({
      ...(collectionWithViews as unknown as typeof collection),
      fields: enrichedFields,
      ...draftSplitResponseFields(draftSplit),
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
    // Schema DDL: refuse when the builder is disabled for this environment.
    requireBuilderEnabled("update-collection");

    // Initialize services first so the permission cache / DB is ready
    const registry = await getCollectionRegistry();

    await requireRoutePermission(request, "manage", "settings");

    const { slug } = await context.params;

    // Body parse failure is a client error; surface as a single-issue
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
      // Same rules as the ui-schema.json mirror (see api/fields-payload).
      assertValidFieldsPayload(body.fields, { kind: "collection" });
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

    // Draft/Published toggle: forward the boolean so the registry layer
    // can flip the status column without disturbing other admin fields.
    if (body.status !== undefined) {
      updateData.status = body.status === true;
    }

    // i18n toggle: forward the localization flag. The registry stores it and the
    // companion `_locales` table is provisioned/removed on the next migrate
    // (migration-gated, via the schema-change preview).
    if (body.localized !== undefined) {
      updateData.localized = body.localized === true;
    }

    // Version history toggle, normalized to the resolved config the column
    // holds; off writes null. `status` is deliberately not passed to the
    // resolver — it aliases to a versioned config for back-compat, which would
    // stop the toggle from turning versioning off on a Draft/Published
    // collection.
    // Retention without the on/off switch is ambiguous — the resolver needs to
    // know whether history is enabled — so a retention-only patch is rejected
    // rather than silently ignored. The switch and its retention always travel
    // together from the Builder.
    if (body.versionsMaxPerDoc !== undefined && body.versions === undefined) {
      throw NextlyError.validation({
        errors: [
          {
            path: "versionsMaxPerDoc",
            code: "MISSING_DEPENDENCY",
            message: "versionsMaxPerDoc requires versions to be set.",
          },
        ],
      });
    }
    if (body.versions !== undefined) {
      updateData.versions = resolveBuilderVersions(
        body.versions === true,
        coerceBuilderMaxPerDoc(body.versionsMaxPerDoc)
      );
    }

    // Cache-revalidation toggle, normalized to the resolved config the write
    // path reads; on writes null (standard tags), off writes the disable config.
    if (body.revalidate !== undefined) {
      updateData.revalidate = resolveBuilderRevalidate(
        body.revalidate === true
      );
    }

    // Webhook recording toggle, normalized to the resolved policy boot reads;
    // on writes null (record), off writes the stored opt-out.
    if (body.webhooks !== undefined) {
      updateData.webhooks = resolveBuilderWebhooks(body.webhooks === true);
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
    // Schema DDL: refuse when the builder is disabled for this environment.
    requireBuilderEnabled("delete-collection");

    // Initialize services first so the permission cache / DB is ready
    const registry = await getCollectionRegistry();

    await requireRoutePermission(request, "manage", "settings");

    const { slug } = await context.params;

    await registry.deleteCollection(slug);

    return new Response(null, { status: 204 });
  }
);
