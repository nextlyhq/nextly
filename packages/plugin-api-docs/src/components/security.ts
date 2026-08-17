/**
 * OpenAPI security schemes and the auth → operation-security mapping.
 *
 * Nextly authenticates two ways — a session cookie (`nextly_session`) and a
 * Bearer API key — and an operation is reachable by EITHER, so a non-public
 * operation lists both as alternatives (OpenAPI OR semantics across array
 * entries). The finer RBAC permission an operation carries is a runtime check
 * surfaced via the operation's `x-nextly-permission` extension rather than the
 * security model, because OpenAPI security schemes express identity, not
 * authorization.
 *
 * @module components/security
 * @since alpha
 */
import type { DocsAuthMode } from "../descriptors";

/** `components.securitySchemes`. */
export const SECURITY_SCHEMES = {
  cookieAuth: {
    type: "apiKey",
    in: "cookie",
    name: "nextly_session",
    description: "Admin session cookie issued at login.",
  },
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    description: "API key sent as `Authorization: Bearer <key>`.",
  },
} as const;

/** OpenAPI security requirement: scheme name → empty scopes array. */
export type SecurityRequirement = Record<string, []>;

/**
 * Map an auth mode to an OpenAPI operation `security` value. `public` → `[]`
 * (explicitly no security); otherwise cookie OR bearer.
 */
export function securityFor(auth: DocsAuthMode): SecurityRequirement[] {
  if (auth === "public") return [];
  return [{ cookieAuth: [] }, { bearerAuth: [] }];
}
