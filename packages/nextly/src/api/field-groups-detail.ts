/**
 * Components Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual component management endpoints at /api/field-groups/[slug].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/field-groups/[slug]/route.ts
 * export { GET, PATCH, DELETE } from 'nextly/api/field-groups-detail';
 * ```
 *
 * @module api/field-groups-detail
 */

import { getService } from "../di";
import type { FieldGroupMetadataService } from "../domains/field-groups/services/field-group-metadata-service";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { FieldGroupRegistryService } from "../services/field-groups/field-group-registry-service";
import { requireBuilderEnabled } from "../shared/builder-access";

import { assertValidFieldsPayload } from "./fields-payload";
import { respondDoc, respondMutation } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * The service that owns a field group's physical schema and its registry row together.
 *
 * Mirrors `api/field-groups.ts`, deliberately: a mounted route reaching the registry directly is
 * how this transport came to write metadata without the DDL it describes.
 */
async function getFieldGroupMetadataService(): Promise<FieldGroupMetadataService> {
  await getCachedNextly();
  return getService("fieldGroupMetadataService");
}

/**
 * Read one property of a parsed body at the type the service expects, or refuse.
 *
 * The body arrives as `Record<string, unknown>` because it is whatever the client sent. Passing a
 * value of the wrong type straight through — which this route did — stores it: a numeric `label`
 * reached the registry and became the field group's display name. Refusing names the offending
 * property, which is also what makes the failure fixable from the client side.
 *
 * `undefined` stays `undefined` rather than becoming an error, because absent means UNTOUCHED for
 * every property of a PATCH.
 */
function expect<T extends "string" | "boolean" | "object">(
  body: Record<string, unknown>,
  key: string,
  kind: T
):
  | (T extends "string"
      ? string
      : T extends "boolean"
        ? boolean
        : Record<string, unknown>)
  | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  const matches =
    kind === "object"
      ? typeof value === "object" && value !== null && !Array.isArray(value)
      : typeof value === kind;
  if (!matches) {
    throw NextlyError.validation({
      errors: [
        {
          path: key,
          code: "invalid_type",
          message: `Expected ${key} to be ${kind === "object" ? "an object" : `a ${kind}`}.`,
        },
      ],
    });
  }
  return value as never;
}

async function getComponentRegistry(): Promise<FieldGroupRegistryService> {
  await getCachedNextly();
  return getService("fieldGroupRegistryService");
}

/**
 * GET handler for retrieving a single component by slug.
 *
 * Requires read-settings (or manage-settings), matching the dispatcher's
 * components authorization.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    await requireRouteAnyPermission(request, [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);

    const { slug } = await context.params;
    const registry = await getComponentRegistry();
    const component = await registry.getComponent(slug);

    return respondDoc(component);
  }
);

/**
 * PATCH handler for updating a component.
 *
 * Requires update-settings (or manage-settings), matching the dispatcher's
 * components authorization. The registry returns 403 (mapped to LOCKED in
 * `logContext`) if the component is locked (code-first components cannot be
 * modified via API).
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    // Schema DDL: refuse when the builder is disabled for this environment.
    requireBuilderEnabled("update-component");

    await requireRouteAnyPermission(request, [
      { action: "update", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);

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

    if (body.fields !== undefined) {
      // Same rules as the ui-schema.json mirror (see api/fields-payload).
      assertValidFieldsPayload(body.fields);
    }

    // 🔴 Through the metadata service, not the registry. Writing the registry directly is what made
    // this route store a new field set and a matching `schema_hash` while running no DDL — the
    // table kept its old columns, and only the dispatcher's copy of this operation ever moved them.
    // The service owns the physical change and the row write together, so every transport that
    // edits a field group now performs the whole operation.
    const metadata = await getFieldGroupMetadataService();
    const { record } = await metadata.updateFieldGroup({
      slug,
      label: expect(body, "label", "string"),
      description: expect(body, "description", "string"),
      admin: expect(body, "admin", "object"),
      // Already validated in shape by `assertValidFieldsPayload` above, which is the same check the
      // ui-schema mirror applies; the cast carries that result across the untyped body boundary.
      fields: body.fields as FieldDefinition[] | undefined,
      localized: expect(body, "localized", "boolean"),
      source: "ui",
    });

    return respondMutation("Field group updated.", record);
  }
);

/**
 * DELETE handler for removing a component.
 *
 * Requires delete-settings (or manage-settings), matching the dispatcher's
 * components authorization. The registry returns 403 if the component is
 * locked, or 409 if it is referenced by other entities.
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    // Schema DDL: refuse when the builder is disabled for this environment.
    requireBuilderEnabled("delete-component");

    await requireRouteAnyPermission(request, [
      { action: "delete", resource: "settings" },
      { action: "manage", resource: "settings" },
    ]);

    const { slug } = await context.params;
    const registry = await getComponentRegistry();

    await registry.deleteComponent(slug);

    return new Response(null, { status: 204 });
  }
);
