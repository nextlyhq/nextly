/**
 * The plugin's internal operation model.
 *
 * One shape both operation sources map onto: the core admin-REST introspection
 * seam (`listAdminRestOperations`, imported from the plugin-sdk) and the
 * plugin-route view (`listPluginRoutes`). Keeping a single model means the
 * generator has one input type regardless of where an operation came from.
 *
 * @module descriptors
 * @since alpha
 */
import type { AdminRestOperation } from "@nextlyhq/plugin-sdk";

/** Verbs an OpenAPI operation may carry (route handlers can also export HEAD/OPTIONS). */
export type DocsVerb =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** How an operation is secured (mirrors the seam's `RestAuthMode`). */
export type DocsAuthMode = "public" | "authenticated" | "permission";

/** The canonical response envelope (mirrors the seam's `RestEnvelope`). */
export type DocsEnvelope =
  "list" | "doc" | "mutation" | "action" | "data" | "total" | "bulk";

/** A single documented operation. */
export interface DocsOperation {
  /** Service name ("users", "plugins", ...). */
  service: string;
  /** Operation identity — the operationId basis. */
  operation: string;
  /** HTTP verb. */
  method: DocsVerb;
  /** Path relative to the mount root, leading "/", OpenAPI `{param}` style. */
  path: string;
  /** How the operation is secured. */
  auth: DocsAuthMode;
  /** Required when `auth === "permission"`; an RBAC slug. */
  permissionSlug?: string;
  /** Grouping tag. */
  tag: string;
  /** The canonical response envelope kind. */
  envelope?: DocsEnvelope;
  /** Optional summary (e.g. from a plugin route's `openapi?` annotation). */
  summary?: string;
  /** Optional longer description. */
  description?: string;
  /** Optional extra grouping tags, merged with `tag` in the operation. */
  tags?: readonly string[];
  /** Surface-specific success schema (overrides the envelope $ref). */
  responseSchema?: Record<string, unknown>;
  /** Surface-specific request-body schema for write operations. */
  requestSchema?: Record<string, unknown>;
  /** Upload bodies are multipart/form-data (file part + metadata), not JSON. */
  requestMultipart?: boolean;
  /** Success status override (e.g. 201 for creates). */
  successStatus?: number;
}

/**
 * Adopt the core seam's admin REST operations as DocsOperations. The shapes are
 * structurally identical; the copy decouples the plugin's model from the seam's
 * so either can evolve without dragging the other.
 */
export function restOperationsToDocs(
  ops: readonly AdminRestOperation[]
): DocsOperation[] {
  return ops.map(op => ({ ...op }));
}
