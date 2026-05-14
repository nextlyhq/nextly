/**
 * OpenAPI surface for the playground.
 *
 * Mounted as a catch-all so a single file covers:
 *
 *   GET /admin/api/openapi              → docs UI page
 *   GET /admin/api/openapi/openapi.json → OAS 3.1 JSON
 *   GET /admin/api/openapi/openapi.yaml → OAS 3.1 YAML
 *
 * The literal `openapi` segment makes this route more specific than the
 * `/admin/api/[[...params]]` catch-all sibling, so Next.js prefers it.
 *
 * The docs UI defaults to the Scalar renderer when `@scalar/api-reference`
 * is installed and falls back to a minimal HTML page otherwise — see
 * `packages/nextly/src/openapi/renderer/` for both implementations.
 */
import { openApiHandler } from "nextly/api/openapi";

export const GET = openApiHandler.GET;
