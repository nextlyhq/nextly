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
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/singles-schema-detail';
 * ```
 *
 * @module api/singles-schema-detail
 */

import type { FieldConfig } from "@nextly/collections";

import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getNextlyLogger } from "../observability/logger";
import type { ComponentRegistryService } from "../services/components/component-registry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";

import { requireAuthHeader } from "./auth-header-only";
import { respondDoc, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getSingleRegistry(): Promise<SingleRegistryService> {
  await getCachedNextly();
  return getService("singleRegistryService");
}

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getCachedNextly();
  return getService("componentRegistryService");
}

/**
 * GET handler for retrieving a Single's schema/metadata by slug.
 *
 * Requires authentication.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    requireAuthHeader(request);

    const { slug } = await context.params;
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

    return respondDoc({
      ...single,
      fields: enrichedFields,
    } as unknown as typeof single);
  }
);

/**
 * PATCH handler for updating a Single's schema/metadata.
 *
 * Requires authentication. The registry returns 403 if the Single is locked
 * (code-first Singles cannot be modified via API).
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    requireAuthHeader(request);

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

    if (Object.keys(adminOverrides).length > 0) {
      const existing = await registry.getSingle(slug);
      updateData.admin = {
        ...(existing.admin || {}),
        ...adminOverrides,
      };
    }

    if (body.accessRules !== undefined) {
      updateData.accessRules = body.accessRules;
    }

    // Update Single (source: "ui" to enforce locking rules)
    const updated = await registry.updateSingle(slug, updateData, {
      source: "ui",
    });

    // Update endpoint: canonical mutation envelope so the admin gets a
    // server-authored toast message alongside the refreshed Single.
    return respondMutation("Single schema updated.", updated);
  }
);

/**
 * DELETE handler for removing a Single.
 *
 * Requires authentication. The registry returns 403 if the Single is locked
 * (code-first Singles cannot be deleted via API). Singles require
 * `force: true` to delete because they represent persistent site-wide
 * configuration.
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    requireAuthHeader(request);

    const { slug } = await context.params;
    const registry = await getSingleRegistry();

    await registry.deleteSingle(slug, { force: true });

    return new Response(null, { status: 204 });
  }
);
