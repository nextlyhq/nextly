/**
 * OpenAPI document assembly.
 *
 * Combines the operation sources into a complete OpenAPI 3.1 document: the
 * admin REST operations (core seam via the sdk), the plugin-route operations
 * (sdk view), and the filesystem scan (where the app mounts things). Error and
 * envelope components are generated from the live enum / the canonical response
 * shapes; security schemes reflect the cookie + bearer auth model.
 *
 * When the host config's content surfaces are supplied (`content`), the
 * templated collection/single entry operations EXPAND into concrete per-slug
 * paths whose request/response schemas are emitted from the user's `fields[]` —
 * dynamic docs: add a collection or field, and the next request documents it.
 *
 * @module generate
 * @since alpha
 */
import type { AdminRestOperation } from "@nextlyhq/plugin-sdk";

import { buildEnvelopeSchemas } from "./components/envelopes";
import { buildErrorComponents } from "./components/errors";
import { SECURITY_SCHEMES } from "./components/security";
import type { DocsOperation } from "./descriptors";
import { restOperationsToDocs } from "./descriptors";
import type { ComponentSchemas, ContentSurfaceLike } from "./fields";
import { entrySchema, fieldsToSchema } from "./fields";
import { buildPaths, mountBasePath, type OpenApiPaths } from "./paths";
import type { ScanResult } from "./scan";

/** Host-config content surfaces for dynamic expansion. */
export interface ContentConfig {
  collections?: readonly ContentSurfaceLike[];
  singles?: readonly ContentSurfaceLike[];
  fieldGroups?: readonly ContentSurfaceLike[];
}

/** Input to the generator. */
export interface OpenApiInput {
  /** The filesystem scan result (mounts + verbs). */
  scan: ScanResult;
  /** Admin REST operations (from the core seam). */
  restOperations?: readonly DocsOperation[];
  /** Plugin-route operations (derived from the sdk's plugin-route view). */
  pluginOperations?: readonly DocsOperation[];
  /** The app's content surfaces; enables dynamic per-slug expansion. */
  content?: ContentConfig;
  /** `info.title` / `info.version` overrides. */
  info?: { title?: string; version?: string };
  /** Optional `servers[0].url`. */
  serverUrl?: string;
}

/** The generated OpenAPI document (loosely typed JSON). */
export type OpenApiDocument = Record<string, unknown>;

/** Default base when the scan found no catch-all mount (e.g. a public-only app). */
const DEFAULT_CATCHALL_BASE = "/admin/api";

/** Collection/single entry operations that expand per slug. */
const TEMPLATED_ENTRY_PREFIXES = [
  "/collections/{collectionName}",
  "/singles/{slug}",
];

function isTemplatedContentOp(op: DocsOperation): boolean {
  return TEMPLATED_ENTRY_PREFIXES.some(p => op.path.startsWith(p));
}

/**
 * Expand the templated collection/single operations into concrete per-slug
 * operations with fields-derived schemas. Definition-level ops (list/create/
 * schema preview) keep their templated form; per-slug entry ops replace the
 * template so each surface appears once with real schemas.
 */
function expandContentOperations(
  ops: readonly DocsOperation[],
  content: ContentConfig | undefined,
  components: ComponentSchemas
): DocsOperation[] {
  if (!content) return [...ops];

  // Register component (field-group) schemas first so $refs resolve.
  for (const group of content.fieldGroups ?? []) {
    components.schemas[`Component_${group.slug}`] ??= {
      ...fieldsToSchema(group.fields ?? [], components),
      description: `Fields of the "${group.slug}" field group.`,
    };
  }

  const out: DocsOperation[] = [];
  for (const op of ops) {
    if (!isTemplatedContentOp(op)) {
      out.push(op);
      continue;
    }
    const isCollection = op.path.startsWith("/collections/{collectionName}");
    const surfaces = isCollection
      ? (content.collections ?? [])
      : (content.singles ?? []);
    for (const surface of surfaces) {
      const param = isCollection ? "{collectionName}" : "{slug}";
      const label =
        surface.labels?.plural ?? surface.labels?.singular ?? surface.slug;
      const schema = entrySchema(surface.fields ?? [], components);
      // POST bodies enforce required fields; PATCH bodies are all-optional.
      const postSchema = fieldsToSchema(surface.fields ?? [], components);
      const patchSchema = fieldsToSchema(surface.fields ?? [], components, {
        allOptional: true,
      });
      out.push({
        ...op,
        operation: `${op.operation}.${surface.slug}`,
        path: op.path.replaceAll(param, surface.slug),
        permissionSlug: op.permissionSlug?.replaceAll(
          isCollection ? "{collectionName}" : "{slug}",
          surface.slug
        ),
        tag: label,
        // Reads answer the document; writes answer the mutation envelope with
        // the document inside; write bodies are the fields themselves.
        responseSchema:
          op.envelope === "doc"
            ? schema
            : op.envelope === "list"
              ? {
                  type: "object",
                  required: ["items", "meta"],
                  properties: {
                    items: { type: "array", items: schema },
                    meta: { $ref: "#/components/schemas/PaginationMeta" },
                  },
                }
              : op.envelope === "mutation"
                ? {
                    type: "object",
                    required: ["message"],
                    properties: {
                      message: { type: "string" },
                      item: schema,
                      warnings: { type: "array", items: { type: "string" } },
                    },
                  }
                : undefined,
        requestSchema:
          op.method === "POST"
            ? postSchema
            : op.method === "PATCH"
              ? patchSchema
              : undefined,
      });
    }
  }
  return out;
}

/**
 * Generate a complete OpenAPI 3.1 document. Pure: takes the scan + operation
 * lists + content surfaces as input, so it is fully testable without booting.
 */
export function generateOpenApiDocument(input: OpenApiInput): OpenApiDocument {
  const components = { schemas: {}, refs: new Map() };
  const restOperations =
    input.restOperations ?? restOperationsToDocs([] as AdminRestOperation[]);
  const pluginOperations = input.pluginOperations ?? [];
  const { errorResponseSchema, responsesByStatus } = buildErrorComponents();

  // Dynamic expansion replaces templated per-slug entry ops with concrete ones.
  const expanded = expandContentOperations(
    [...restOperations, ...pluginOperations],
    input.content,
    components
  );

  const catchAllMounts = input.scan.routes.filter(
    r => r.source.kind === "dynamic-catchall"
  );
  const bases =
    catchAllMounts.length > 0
      ? catchAllMounts.map(m => mountBasePath(m.mountPath))
      : [DEFAULT_CATCHALL_BASE];

  let paths: OpenApiPaths = {};
  for (const base of bases) {
    paths = {
      ...paths,
      ...buildPaths(base, expanded, responsesByStatus),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: input.info?.title ?? "Nextly API",
      version: input.info?.version ?? "0.0.0",
    },
    ...(input.serverUrl ? { servers: [{ url: input.serverUrl }] } : {}),
    paths,
    components: {
      schemas: {
        ErrorResponse: errorResponseSchema,
        ...buildEnvelopeSchemas(),
        ...components.schemas,
      },
      responses: responsesByStatus,
      securitySchemes: SECURITY_SCHEMES,
    },
  };
}
