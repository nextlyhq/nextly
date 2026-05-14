/**
 * Generator pipeline — `serialize` phase.
 *
 * Converts the internal `DocumentIR` to an OAS-shaped object, validates
 * that every `$ref` to a `components/schemas/*` or `components/responses/*`
 * resolves to a registered entry, and then renders the result as either
 * JSON (default) or YAML. Returns a Buffer ready for the route handler.
 *
 * Why validation here: dangling refs are the single most common bug class
 * when assembling specs by hand (a mapper emits `$ref('Foo')` but nobody
 * registered `Foo`). Catching them at serialization time produces a clear
 * error during generation rather than silent rendering of a broken doc.
 *
 * Only `schemas` and `responses` namespaces are validated in Phase 1; the
 * other component types (parameters, requestBodies, examples, headers,
 * callbacks, links) pass through verbatim and rely on downstream
 * validators (`@apidevtools/openapi-schemas` in T16+).
 *
 * Spec: §11.7 (YAML), §14.4 (validation).
 *
 * @module nextly/openapi/generator/serialize
 */

import YAML from "yaml";

import type {
  DocumentIR,
  OperationIR,
  ParameterIR,
  RequestBodyIR,
  ResponseIR,
  ResponseMapIR,
} from "../ir/types";

export type SerializeFormat = "json" | "yaml";

export function serialize(doc: DocumentIR, format: SerializeFormat): Buffer {
  validateRefs(doc);
  const oas = irToOas(doc);
  if (format === "yaml") return Buffer.from(YAML.stringify(oas), "utf8");
  return Buffer.from(JSON.stringify(oas, null, 2), "utf8");
}

// ─── IR -> OAS ────────────────────────────────────────────────────────────

function irToOas(doc: DocumentIR): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of doc.operations) {
    const pathBucket = paths[op.path] ?? {};
    pathBucket[op.method.toLowerCase()] = operationToOas(op);
    paths[op.path] = pathBucket;
  }

  const components: Record<string, unknown> = {};
  if (Object.keys(doc.components.schemas).length > 0) {
    components.schemas = doc.components.schemas;
  }
  if (Object.keys(doc.components.responses).length > 0) {
    components.responses = doc.components.responses;
  }
  if (Object.keys(doc.components.parameters).length > 0) {
    components.parameters = doc.components.parameters;
  }
  if (Object.keys(doc.components.requestBodies).length > 0) {
    components.requestBodies = doc.components.requestBodies;
  }
  if (Object.keys(doc.components.securitySchemes).length > 0) {
    components.securitySchemes = doc.components.securitySchemes;
  }

  return {
    openapi: doc.openapi,
    info: doc.info,
    ...(doc.servers.length > 0 ? { servers: doc.servers } : {}),
    ...(doc.tags.length > 0 ? { tags: doc.tags } : {}),
    paths,
    components,
    ...doc.extensions,
  };
}

function operationToOas(op: OperationIR): Record<string, unknown> {
  const out: Record<string, unknown> = { operationId: op.operationId };
  if (op.tags.length > 0) out.tags = op.tags;
  if (op.summary !== undefined) out.summary = op.summary;
  if (op.description !== undefined) out.description = op.description;
  if (op.deprecated === true) out.deprecated = true;
  if (op.parameters.length > 0) out.parameters = op.parameters;
  if (op.requestBody !== undefined) out.requestBody = op.requestBody;
  out.responses = op.responses;
  if (op.security.length > 0) out.security = op.security;
  return { ...out, ...op.extensions };
}

// ─── $ref validation ─────────────────────────────────────────────────────

const SCHEMA_REF_PREFIX = "#/components/schemas/";
const RESPONSE_REF_PREFIX = "#/components/responses/";

function validateRefs(doc: DocumentIR): void {
  const knownSchemas = new Set(Object.keys(doc.components.schemas));
  const knownResponses = new Set(Object.keys(doc.components.responses));

  for (const op of doc.operations) {
    walkOperation(op, knownSchemas, knownResponses);
  }
  // Refs INSIDE schema bodies (e.g. a schema using $ref to another schema)
  // are caught by walking components.schemas itself.
  walkValue(
    doc.components.schemas,
    "components.schemas",
    knownSchemas,
    knownResponses
  );
  walkValue(
    doc.components.responses,
    "components.responses",
    knownSchemas,
    knownResponses
  );
}

function walkOperation(
  op: OperationIR,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  const base = `paths[${op.path}].${op.method.toLowerCase()}`;
  for (const param of op.parameters) {
    walkParameter(param, `${base}.parameters`, knownSchemas, knownResponses);
  }
  if (op.requestBody) {
    walkRequestBody(
      op.requestBody,
      `${base}.requestBody`,
      knownSchemas,
      knownResponses
    );
  }
  walkResponses(
    op.responses,
    `${base}.responses`,
    knownSchemas,
    knownResponses
  );
}

function walkParameter(
  param: ParameterIR,
  path: string,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  walkValue(
    param.schema,
    `${path}.${param.name}.schema`,
    knownSchemas,
    knownResponses
  );
}

function walkRequestBody(
  body: RequestBodyIR,
  path: string,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  for (const [mediaType, media] of Object.entries(body.content)) {
    walkValue(
      media.schema,
      `${path}.content.${mediaType}.schema`,
      knownSchemas,
      knownResponses
    );
  }
}

function walkResponses(
  responses: ResponseMapIR,
  path: string,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  for (const [status, response] of Object.entries(responses)) {
    const here = `${path}.${status}`;
    if (isRefObject(response)) {
      checkRef(response.$ref, here, knownSchemas, knownResponses);
      continue;
    }
    walkInlineResponse(response, here, knownSchemas, knownResponses);
  }
}

function walkInlineResponse(
  response: ResponseIR,
  path: string,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  if (!response.content) return;
  for (const [mediaType, media] of Object.entries(response.content)) {
    walkValue(
      media.schema,
      `${path}.content.${mediaType}.schema`,
      knownSchemas,
      knownResponses
    );
  }
}

/**
 * Recursively scan an arbitrary value (schema, schema fragment, parameter,
 * etc.) for `$ref` strings in the `schemas` and `responses` namespaces and
 * verify they resolve.
 */
function walkValue(
  value: unknown,
  path: string,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkValue(value[i], `${path}[${i}]`, knownSchemas, knownResponses);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(obj)) {
    if (key === "$ref" && typeof child === "string") {
      checkRef(child, path, knownSchemas, knownResponses);
      continue;
    }
    walkValue(child, `${path}.${key}`, knownSchemas, knownResponses);
  }
}

function checkRef(
  ref: string,
  path: string,
  knownSchemas: ReadonlySet<string>,
  knownResponses: ReadonlySet<string>
): void {
  if (ref.startsWith(SCHEMA_REF_PREFIX)) {
    const name = ref.slice(SCHEMA_REF_PREFIX.length);
    if (!knownSchemas.has(name)) {
      throw new Error(`dangling $ref at ${path}: ${ref}`);
    }
    return;
  }
  if (ref.startsWith(RESPONSE_REF_PREFIX)) {
    const name = ref.slice(RESPONSE_REF_PREFIX.length);
    if (!knownResponses.has(name)) {
      throw new Error(`dangling $ref at ${path}: ${ref}`);
    }
    return;
  }
  // Other namespaces (parameters, requestBodies, examples, ...) pass
  // through unvalidated in Phase 1.
}

function isRefObject(v: unknown): v is { $ref: string } {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).$ref === "string"
  );
}
