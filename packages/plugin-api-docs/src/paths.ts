/**
 * Turn documented operations + scanned mounts into OpenAPI `paths`.
 *
 * An operation carries a path RELATIVE to its mount root; the generator joins it
 * with the mount's base (catch-all segment stripped) to produce the full OpenAPI
 * path. Each operation lands under its lowercased HTTP verb, tagged and secured
 * per its auth mode, with the generated error responses attached.
 *
 * @module paths
 * @since alpha
 */
import { genericJsonRequest, successResponse } from "./components/envelopes";
import type { OpenApiResponse } from "./components/errors";
import { securityFor } from "./components/security";
import type { DocsOperation } from "./descriptors";

export type OpenApiOperation = Record<string, unknown>;
export type OpenApiPaths = Record<string, Record<string, unknown>>;

/**
 * Strip a trailing dynamic/catch-all segment to get the static mount base.
 * `/admin/api/[[...params]]` → `/admin/api`; a static mount like `/api/health`
 * is returned unchanged.
 */
export function mountBasePath(mountPath: string): string {
  const segs = mountPath.split("/");
  const last = segs[segs.length - 1];
  if (last.startsWith("[")) segs.pop();
  return segs.join("/") || "/";
}

/** Join a mount base with a relative operation path (one leading "/" kept). */
export function joinPath(base: string, relative: string): string {
  const left = base.endsWith("/") ? base.slice(0, -1) : base;
  const right = relative.startsWith("/") ? relative : `/${relative}`;
  return `${left}${right}`;
}

/**
 * Build one OpenAPI operation. The RBAC slug rides along as a vendor extension
 * (`x-nextly-permission`) so consumers can see the requirement the security
 * model cannot express. Success responses come from the operation's envelope
 * (or its surface-specific schema), and write verbs carry a request body.
 */
export function buildOperation(
  op: DocsOperation,
  errorResponses: Record<string, OpenApiResponse>
): OpenApiOperation {
  const success = successResponse(op.envelope, {
    status: op.successStatus,
    schema: op.responseSchema,
    description: op.responseSchema ? "The document." : undefined,
  });
  const responses = { ...success, ...errorResponses };
  const operation: OpenApiOperation = {
    operationId: op.operation,
    tags: [op.tag],
    security: securityFor(op.auth),
    responses,
  };
  if (op.method === "POST" || op.method === "PATCH" || op.method === "PUT") {
    operation.requestBody = op.requestSchema
      ? {
          required: true,
          content: { "application/json": { schema: op.requestSchema } },
        }
      : genericJsonRequest();
  }
  // Extra tags (a plugin's openapi.tags) merge with the primary tag.
  if (op.tags && op.tags.length > 0) {
    operation.tags = [op.tag, ...op.tags];
  }
  // Optional annotation — omitted entirely when absent.
  if (op.summary) operation.summary = op.summary;
  if (op.description) operation.description = op.description;
  if (op.auth === "permission" && op.permissionSlug) {
    operation["x-nextly-permission"] = op.permissionSlug;
  }
  return operation;
}

/**
 * Fold a list of operations into a `paths` map under a shared mount base. Two
 * operations that resolve to the same full path merge their verbs into one path
 * item (the normal REST shape).
 */
export function buildPaths(
  mountBase: string,
  operations: readonly DocsOperation[],
  errorResponses: Record<string, OpenApiResponse>
): OpenApiPaths {
  const paths: OpenApiPaths = {};
  for (const op of operations) {
    const fullPath = joinPath(mountBase, op.path);
    const pathItem = (paths[fullPath] ??= {});
    // OpenAPI operation keys are lowercased HTTP verbs.
    pathItem[op.method.toLowerCase()] = buildOperation(op, errorResponses);
  }
  return paths;
}
