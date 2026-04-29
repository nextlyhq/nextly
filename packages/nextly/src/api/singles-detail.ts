/**
 * Singles Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual Single management endpoints at /api/singles/[slug].
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
 * // In your Next.js app: app/api/singles/[slug]/route.ts
 * export { GET, PATCH } from '@revnixhq/nextly/api/singles-detail';
 * ```
 *
 * @module api/singles-detail
 */

import { getService } from "../di";
import type { SingleResult } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import { transformRichTextFields } from "../lib/field-transform";
import type { RichTextOutputFormat } from "../lib/rich-text-html";
import type { SingleEntryService } from "../services/singles/single-entry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getSingleEntryService(): Promise<SingleEntryService> {
  await getNextly();
  return getService("singleEntryService");
}

async function getSingleRegistry(): Promise<SingleRegistryService> {
  await getNextly();
  return getService("singleRegistryService");
}

/**
 * Stub auth check — preserves the legacy behavior of accepting any request
 * with an `Authorization` header. The real token validation lands when the
 * auth middleware migration completes; until then, presence-only is the
 * documented contract for this surface (matches the PR-7 stub in
 * `singles-schema-detail.ts`).
 */
function requireAuthHeader(request: Request): void {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    throw NextlyError.authRequired();
  }
  // TODO: Validate the auth token and extract user ID
}

/**
 * Parse a JSON request body and convert a parse failure into the canonical
 * `VALIDATION_ERROR`. The slug context is supplied separately so the same
 * helper works for any handler in this file.
 */
async function readJsonBody(
  req: Request,
  slug: string
): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      },
      logContext: { slug, reason: "invalid-json-body" },
    });
  }
}

/**
 * Bridge for the legacy `SingleResult` shape (`{ success, statusCode,
 * data?, message?, errors? }`) emitted by `SingleEntryService`. The service
 * still uses the F8 result-shape pattern; converting it to a thrown
 * `NextlyError` at the route boundary keeps the wire format canonical
 * without touching the service layer in Task 8.
 *
 * Mapping:
 *   - 404 → `NextlyError.notFound`. The slug goes to `logContext`; the
 *     public message stays the §13.8-compliant "Not found." (no echo).
 *   - 400 → `NextlyError.validation`. Per-field `errors[]` translate to
 *     the canonical `data.errors[]` shape; the legacy `field` becomes
 *     `path` and a generic `INVALID` code fills the missing slot.
 *   - Anything else → `NextlyError.internal`. The legacy status / message
 *     are preserved in `logContext` so operators can correlate.
 *
 * Removed once `SingleEntryService` is migrated to throw directly.
 */
function throwFromSingleResult<T>(
  result: SingleResult<T>,
  slug: string
): never {
  const logContext: Record<string, unknown> = {
    slug,
    legacyStatusCode: result.statusCode,
    legacyMessage: result.message,
  };
  if (result.errors) logContext.legacyErrors = result.errors;

  if (result.statusCode === 404) {
    throw NextlyError.notFound({ logContext });
  }

  if (result.statusCode === 400) {
    throw NextlyError.validation({
      errors: (result.errors ?? []).map(e => ({
        path: e.field ?? "",
        code: "INVALID",
        message: e.message,
      })),
      logContext,
    });
  }

  throw NextlyError.internal({ logContext });
}

const VALID_RICH_TEXT_FORMATS = ["json", "html", "both"] as const;

function parseRichTextFormat(value: string | null): RichTextOutputFormat {
  if (!value) return "json";
  const normalized = value.toLowerCase();
  if (VALID_RICH_TEXT_FORMATS.includes(normalized as RichTextOutputFormat)) {
    return normalized as RichTextOutputFormat;
  }
  return "json";
}

/**
 * GET handler for retrieving a Single document by slug.
 *
 * This is a public endpoint - no authentication required.
 * If the Single document doesn't exist, it will be auto-created with default
 * field values.
 *
 * Query Parameters:
 * - depth: Relationship expansion depth (reserved for future use)
 * - locale: Locale for localized fields (reserved for future use)
 * - richTextFormat: Output format for rich text fields ("json" | "html" | "both")
 *   - "json" (default): Return Lexical JSON structure only
 *   - "html": Return HTML string only
 *   - "both": Return object with both { json, html } properties
 *
 * Response:
 * - 200 OK: `{ "data": { ... } }`
 * - On error: `application/problem+json` per spec §10.1.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    const { slug } = await context.params;
    const service = await getSingleEntryService();

    const { searchParams } = new URL(request.url);
    const depth = searchParams.get("depth")
      ? parseInt(searchParams.get("depth")!, 10)
      : undefined;
    const locale = searchParams.get("locale") || undefined;
    const richTextFormat = parseRichTextFormat(
      searchParams.get("richTextFormat")
    );

    const result = await service.get(slug, { depth, locale });

    if (!result.success) {
      throwFromSingleResult(result, slug);
    }

    let responseData = result.data;
    if (richTextFormat !== "json" && result.data) {
      const registry = await getSingleRegistry();
      const single = await registry.getSingleBySlug(slug);

      if (single?.fields && Array.isArray(single.fields)) {
        responseData = transformRichTextFields(
          result.data,
          single.fields,
          richTextFormat
        ) as typeof result.data;
      }
    }

    return withTimezoneFormatting(createSuccessResponse(responseData));
  }
);

/**
 * PATCH handler for updating a Single document.
 *
 * Requires authentication. If the Single document doesn't exist,
 * it will be auto-created first, then updated with the provided data.
 *
 * Note: Singles cannot be deleted. They represent persistent site-wide
 * configuration that always exists once accessed.
 *
 * Request Body:
 * - Any fields defined in the Single schema
 * - System fields (id, createdAt) are ignored if included
 *
 * Response:
 * - 200 OK: `{ "data": { ... } }` (updated document)
 * - On error: `application/problem+json` per spec §10.1.
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { slug } = await context.params;
    const service = await getSingleEntryService();

    const body = await readJsonBody(request, slug);

    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") || undefined;

    const result = await service.update(slug, body, { locale });

    if (!result.success) {
      throwFromSingleResult(result, slug);
    }

    return withTimezoneFormatting(createSuccessResponse(result.data));
  }
);

/**
 * GET handler for retrieving Single schema/metadata by slug.
 *
 * This endpoint returns the Single's schema configuration, not the document data.
 * Useful for Admin UI to understand the field structure.
 *
 * Requires authentication.
 *
 * Response:
 * - 200 OK: `{ "data": { slug, label, fields, ... } }`
 * - 401 / 404 / 500: `application/problem+json` per spec §10.1.
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/singles/site-settings/schema"
 * # => {"data":{"slug":"site-settings","label":"Site Settings","fields":[...]}}
 * ```
 */
export function getSchema(request: Request, slug: string): Promise<Response> {
  return withErrorHandler(async (req: Request) => {
    requireAuthHeader(req);

    const registry = await getSingleRegistry();
    const single = await registry.getSingleBySlug(slug);

    if (!single) {
      // Per §13.7: identifier (slug) goes to logContext, never the public
      // message. The public response is the canonical "Not found." sentence.
      throw NextlyError.notFound({ logContext: { slug } });
    }

    return createSuccessResponse(single);
  })(request);
}
