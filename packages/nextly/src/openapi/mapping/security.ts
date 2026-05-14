/**
 * Build the three OpenAPI security schemes mirroring Nextly's auth modes.
 *
 *   bearerAuth  — JWT in `Authorization: Bearer <token>`
 *   cookieAuth  — Session cookie `nextly_access_token` (browser flow)
 *   apiKeyAuth  — Long-lived service credential `X-API-Key` header
 *
 * Operations select one or more of these via their `security` requirement;
 * Scalar's Try-It panel exposes input boxes for whichever schemes appear.
 *
 * @module nextly/openapi/mapping/security
 */

import type { OpenAPISecurityScheme } from "../types";

export interface SecurityBundle {
  securitySchemes: Record<string, OpenAPISecurityScheme>;
}

export function buildSecuritySchemes(): SecurityBundle {
  return {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT issued by `POST /api/auth/login`. Send as " +
          "`Authorization: Bearer <token>`. Tokens expire after 15 minutes.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "nextly_access_token",
        description:
          "Session cookie set by `POST /api/auth/login` from a browser. " +
          "Cross-site requests need `credentials: 'include'`.",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description:
          "Long-lived service credential managed at `/admin/api-keys`. " +
          "Bypasses RBAC where granted; scope per key.",
      },
    },
  };
}
