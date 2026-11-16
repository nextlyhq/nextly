/**
 * Singles Schema Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual Single schema management endpoints at /api/singles/[slug]/schema.
 *
 * This is separate from the document endpoints (/api/singles/[slug]) which
 * handle the actual content/values of a Single.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/singles/[slug]/schema/route.ts
 * export { GET, PATCH, DELETE } from 'nextly/api/singles-schema-detail';
 * ```
 *
 * @module api/singles-schema-detail
 */

import type { FieldConfig } from "@nextly/collections";

import { getService } from "../di";
import { SCHEMA_CHANGE_PERMISSIONS } from "../domains/auth/system-write-policy";
import { withSchemaChangeExcluded } from "../domains/schema/services/schema-change-exclusion";
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
import { resolveBuilderRevalidate } from "../revalidation/builder-revalidate";
import type { FieldGroupRegistryService } from "../services/field-groups/field-group-registry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";
import { requireBuilderEnabled } from "../shared/builder-access";

import {
  assertBuilderFieldNames,
  assertValidFieldsPayload,
} from "./fields-payload";
import { respondDoc, respondMutation } from "./response-shapes";
import {
  requireRouteAllPermissions,
  requireRouteCollectionAccess,
} from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js passes route params as a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getSingleRegistry(): Promise<SingleRegistryService> {
  await getCachedNextly();
  return getService("singleRegistryService");
}

async function getComponentRegistry(): Promise<FieldGroupRegistryService> {
  await getCachedNextly();
  return getService("fieldGroupRegistryService");
}

/**
 * GET handler for retrieving a Single's schema/metadata by slug.
 *
 * Requires a verified session or API key with read access to the Single,
 * matching the dispatcher's `getSingleSchema` authorization.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { slug } = await context.params;
    await requireRouteCollectionAccess(request, "read", slug);
    const registry = await getSingleRegistry();
    const single = await registry.getSingle(slug);

    // Enrich component fields with inline schemas for Admin UI so form
    // rendering doesn't need extra API calls per component. If enrichment
    // fails (e.g. component registry unavailable), fall back to the raw
    // fields rather than failing the whole request.
    let enrichedFields: Record<string, unknown>[] =
      single.fields as unknown as Record<string, unknown>[];
    try {
      const componentRegistry = await getComponentRegistry();
      enrichedFields = await componentRegistry.enrichFieldsWithComponentSchemas(
        single.fields as unknown as Record<string, unknown>[]
      );
    } catch (enrichError) {
      // Use the unified observability seam instead of console so log
      // sinks pick this up; the original behavior was warn-only.
      getNextlyLogger().warn({
        kind: "single-schema-enrichment-failed",
        slug,
        err: String(enrichError),
      });
    }

    // Whether a status-less save on this Single holds the edit rather than
    // writing the live row. Derived from the SAME predicate the write gates on,
    // so the editor's affordance can never disagree with what a save does — an
    // editor told drafts are off sends an explicit published save, which
    // overwrites the live document.
    //
    // A resolution failure propagates rather than defaulting to false: for a
    // drafts-configured Single, false is the destructive answer.
    const draftSplit = await schemaDraftSplit({
      status: (single as { status?: boolean }).status,
      versions: single.versions,
      fields: single.fields,
      slug: (single as { slug?: string }).slug,
      localized: (single as { localized?: boolean }).localized,
      entityKind: "single",
    });

    return respondDoc({
      ...single,
      fields: enrichedFields,
      ...draftSplitResponseFields(draftSplit),
    } as unknown as typeof single);
  }
);

/**
 * PATCH handler for updating a Single's schema/metadata.
 *
 * Requires create, update and delete on settings, matching the dispatcher's
 * `updateSingleSchema` authorization. The registry returns 403 if the Single
 * is locked (code-first Singles cannot be modified via API).
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    // Schema DDL: refuse when the builder is disabled for this environment.
    requireBuilderEnabled("update-single-schema");

    // A schema change asks create, update and delete on settings.
    await requireRouteAllPermissions(request, SCHEMA_CHANGE_PERMISSIONS);

    const { slug } = await context.params;
    const registry = await getSingleRegistry();

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

    if (body.label !== undefined) {
      updateData.label = body.label;
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (body.fields !== undefined) {
      // Same rules as the ui-schema.json mirror (see api/fields-payload).
      // The names are judged under the lock below, against the row as stored then.
      assertValidFieldsPayload(body.fields, { stored: "under-lock" });
      updateData.fields = body.fields;
      // The registry re-validates the field config; cast through `unknown`
      // to avoid `any` while keeping the existing trust boundary.
      updateData.schemaHash = calculateSchemaHash(
        body.fields as unknown as FieldConfig[]
      );
    }

    // Admin fields: support both nested `admin` object and flat top-level
    // fields. The registry's `updateSingle` expects `data.admin` as a merged
    // object, so when any admin override is present we fetch the existing
    // Single and merge.
    const ADMIN_KEYS = [
      "icon",
      "group",
      "order",
      "sidebarGroup",
      "hidden",
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

    // Version history toggle, normalized to the resolved config the registry
    // column holds; off writes null. Mirrors the collection detail route.
    // Retention without the on/off switch is ambiguous — the resolver needs to
    // know whether history is enabled — so a retention-only patch is rejected
    // rather than silently ignored. Mirrors the collection detail route.
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
    // path reads; on writes null, off writes the disable config. Mirrors the
    // collection detail route.
    if (body.revalidate !== undefined) {
      updateData.revalidate = resolveBuilderRevalidate(
        body.revalidate === true
      );
    }

    // Webhook recording toggle, normalized to the resolved policy boot reads;
    // on writes null, off writes the stored opt-out. Mirrors the collection
    // detail route.
    if (body.webhooks !== undefined) {
      updateData.webhooks = resolveBuilderWebhooks(body.webhooks === true);
    }

    // The read of the stored admin settings and the row write hold the schema lock together,
    // refused at once while a migration holds it: the row describes storage a migration could be
    // moving. Everything above reads the request alone and is decided before the lock is taken.
    const updated = await withSchemaChangeExcluded(
      {
        adapter: getService("adapter"),
        logger: getService("logger"),
        label: `update single "${slug}"`,
        // This route writes the registry row alone; any table change comes from the next migrate.
        // It issues no DDL, so it must not create the lock table on a role without DDL rights.
        issuesDdl: false,
      },
      async () => {
        const hasOverrides = Object.keys(adminOverrides).length > 0;
        if (hasOverrides || body.fields !== undefined) {
          // As stored, past the registry row cache: the overrides merge into it, so a cached row
          // would write back an admin setting another instance changed a moment ago, and the
          // field names are judged against the fields it holds now.
          const existing = await registry.getSingleForWrite(slug);
          if (!existing) {
            throw NextlyError.notFound({
              logContext: { entity: "Single", slug },
            });
          }
          if (body.fields !== undefined) {
            // A field name the Single already holds keeps working whatever its case; one this
            // save creates is the Builder's own.
            assertBuilderFieldNames(body.fields, existing.fields ?? []);
          }
          if (hasOverrides) {
            updateData.admin = {
              ...(existing.admin || {}),
              ...adminOverrides,
            };
          }
        }

        // Update Single (source: "ui" to enforce locking rules)
        return registry.updateSingle(slug, updateData, {
          source: "ui",
        });
      }
    );

    // Update endpoint: canonical mutation envelope so the admin gets a
    // server-authored toast message alongside the refreshed Single.
    return respondMutation("Single schema updated.", updated);
  }
);

/**
 * DELETE handler for removing a Single.
 *
 * Requires create, update and delete on settings, matching the dispatcher's
 * `deleteSingle` authorization. The registry returns 403 if the Single is locked
 * (code-first Singles cannot be deleted via API). Singles require
 * `force: true` to delete because they represent persistent site-wide
 * configuration. A Single another owner depends on, through a foreign key
 * declared into its tables or a column, index, foreign key or check added to
 * them, is refused with 409 naming each, and with 503 when those cannot be
 * read; nothing is removed either way.
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    // Schema DDL: refuse when the builder is disabled for this environment.
    requireBuilderEnabled("delete-single");

    // A schema change asks create, update and delete on settings.
    await requireRouteAllPermissions(request, SCHEMA_CHANGE_PERMISSIONS);

    const { slug } = await context.params;
    const registry = await getSingleRegistry();

    // The registry's read of the Single and its removal hold the schema lock together, refused at
    // once while a migration holds it.
    await withSchemaChangeExcluded(
      {
        adapter: getService("adapter"),
        logger: getService("logger"),
        label: `delete single "${slug}"`,
        // This route removes rows alone; it issues no DDL, so it must not create the lock table on
        // a role without DDL rights.
        issuesDdl: false,
      },
      async () => {
        // Refused before the row goes, as the Builder's delete refuses before its drops, while a
        // declared key into the Single's tables or another owner's element on them depends on it.
        // A Single that does not exist has nothing to ask about: the delete answers not found.
        const single = await registry.getSingleForWrite(slug);
        if (single) {
          await registry.assertNothingDependsOn({
            slug,
            tableName: single.tableName,
            fields: single.fields,
          });
        }
        await registry.deleteSingle(slug, { force: true });
      }
    );

    return new Response(null, { status: 204 });
  }
);
