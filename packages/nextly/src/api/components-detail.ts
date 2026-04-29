/**
 * Components Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual component management endpoints at /api/components/[slug].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: <result> }` envelope per spec §10.2. Errors are
 * serialized as `application/problem+json`.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/components/[slug]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/components-detail';
 * ```
 *
 * @module api/components-detail
 */

import type { FieldConfig } from "@nextly/collections";

import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import type { ComponentRegistryService } from "../services/components/component-registry-service";

import { requireAuthHeader } from "./auth-header-only";
import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getNextly();
  return getService("componentRegistryService");
}

/**
 * GET handler for retrieving a single component by slug.
 *
 * Requires authentication.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    requireAuthHeader(request);

    const { slug } = await context.params;
    const registry = await getComponentRegistry();
    const component = await registry.getComponent(slug);

    return createSuccessResponse(component);
  }
);

/**
 * PATCH handler for updating a component.
 *
 * Requires authentication. The registry returns 403 (mapped to LOCKED in
 * `logContext`) if the component is locked (code-first components cannot be
 * modified via API).
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    requireAuthHeader(request);

    const { slug } = await context.params;
    const registry = await getComponentRegistry();

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

    if (body.admin !== undefined) {
      updateData.admin = body.admin;
    }

    // Update component (source: "ui" to enforce locking rules)
    const updated = await registry.updateComponent(slug, updateData, {
      source: "ui",
    });

    return createSuccessResponse(updated);
  }
);

/**
 * DELETE handler for removing a component.
 *
 * Requires authentication. The registry returns 403 if the component is
 * locked, or 409 if it is referenced by other entities.
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    requireAuthHeader(request);

    const { slug } = await context.params;
    const registry = await getComponentRegistry();

    await registry.deleteComponent(slug);

    return new Response(null, { status: 204 });
  }
);
