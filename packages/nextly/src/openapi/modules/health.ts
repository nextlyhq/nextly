/**
 * Built-in module: `/api/health`.
 *
 * Mirrors the actual handler in `packages/nextly/src/api/health.ts`:
 *
 *   GET  /api/health  — body { ok, version, uptime, timestamp, database }
 *                       200 OK on healthy DB, 503 when the DB probe fails
 *   HEAD /api/health  — same status codes, no body
 *
 * Health is intentionally public (no security requirement) so external
 * monitoring scrapers don't need an auth token to verify the service is
 * up.
 *
 * @module nextly/openapi/modules/health
 */

import { defineModule } from "../generator/define-module";

export const healthModule = defineModule({
  name: "health",
  tag: {
    name: "Health",
    description: "Service liveness and readiness probes.",
  },
  operations: [
    {
      path: "/api/health",
      method: "GET",
      versions: ["1.0"],
      operationId: "health.get",
      tags: ["Health"],
      summary: "Health check",
      description:
        "Returns the service's database probe, version, and uptime. " +
        "Public — no auth required. Pairs with the HEAD variant for " +
        "lightweight monitoring probes that don't need a body.",
      parameters: [],
      responses: {
        "200": {
          description: "Service is healthy.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthResponse" },
            },
          },
        },
        "503": { $ref: "#/components/responses/ServiceUnavailable" },
      },
      security: [],
      extensions: {},
    },
    {
      path: "/api/health",
      method: "HEAD",
      versions: ["1.0"],
      operationId: "health.head",
      tags: ["Health"],
      summary: "Health probe (body-less)",
      description:
        "Same status semantics as GET /api/health but with no response body. " +
        "Useful for monitoring probes that only need the status code.",
      parameters: [],
      responses: {
        "200": { description: "Service is healthy." },
        "503": { description: "Service is unhealthy." },
      },
      security: [],
      extensions: {},
    },
  ],
  schemas: {
    HealthResponse: {
      type: "object",
      required: ["ok", "version"],
      properties: {
        ok: {
          type: "boolean",
          description:
            "True when the database probe succeeded; false is never sent — " +
            "unhealthy probes return 503 with the canonical Error envelope.",
        },
        version: {
          type: "string",
          description:
            "Package version reported by the running build. Falls back to " +
            "'unknown' when the process is launched outside an npm script.",
        },
        uptime: {
          type: "number",
          minimum: 0,
          description: "Process uptime in seconds. 0 on non-Node runtimes.",
        },
        timestamp: {
          type: "string",
          format: "date-time",
          description: "Server time at which the probe was performed.",
        },
        database: {
          type: "object",
          additionalProperties: true,
          description:
            "Database probe result. Shape varies per adapter (postgres / " +
            "mysql / sqlite); typical fields include `latencyMs` and `dialect`.",
        },
      },
    },
  },
});
