/**
 * Route handler for `admin/api/openapi/*`.
 *
 * Phase 1: stub. Real handler lands in Task 23.
 *
 * @module nextly/api/openapi
 */

export const openApiHandler = {
  GET: (_req: Request): Response =>
    new Response(
      JSON.stringify({ error: "openapi handler not yet implemented" }),
      {
        status: 501,
        headers: { "content-type": "application/json" },
      }
    ),
};
