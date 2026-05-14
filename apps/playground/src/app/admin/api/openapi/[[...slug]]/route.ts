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
 * We bootstrap services via `getNextly({ config })` before delegating to
 * the framework handler. In typical deployments the catch-all has
 * already done this on a prior request, but cold-boot (e.g. the very
 * first request after `next dev`) needs us to do it here.
 *
 * The docs UI defaults to the Scalar renderer when `@scalar/api-reference`
 * is installed and falls back to a minimal HTML page otherwise — see
 * `packages/nextly/src/openapi/renderer/` for both implementations.
 */
import { getNextly } from "nextly";
import { openApiHandler } from "nextly/api/openapi";

import nextlyConfig from "../../../../../../nextly.config";

export async function GET(req: Request): Promise<Response> {
  await getNextly({ config: nextlyConfig });
  return openApiHandler.GET(req);
}
