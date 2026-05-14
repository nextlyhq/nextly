/**
 * Generator pipeline — top-level `generate()` orchestrator.
 *
 * Wires the four phases (collect → infer-collections → infer-singles →
 * serialize) and threads a small `schemaHash`-keyed LRU cache through them.
 *
 *   GenerateArgs
 *      │
 *      ▼
 *   cache.get(cacheKey)  ── hit ──► formatResult (cached buffer)
 *      │ miss
 *      ▼
 *   collect()
 *      │
 *      ▼
 *   inferFromCollections + inferFromSingles
 *      │
 *      ▼
 *   merge module contributions
 *      │
 *      ▼
 *   assemble DocumentIR with shared envelope/error/security components
 *      │
 *      ▼
 *   serialize() → cache.set() → formatResult
 *
 * The `schemaHash` is supplied by the route handler. That keeps the
 * pipeline pure — no second registry roundtrip purely to fingerprint
 * input. Tests can pass any string; production passes a hash derived from
 * registry change events.
 *
 * @module nextly/openapi/generator/pipeline
 */

import { createHash } from "crypto";

import type { DocumentIR, OperationIR, TagIR } from "../ir/types";
import { buildEnvelopeComponents } from "../mapping/envelopes";
import { buildErrorComponents } from "../mapping/errors";
import { buildSecuritySchemes } from "../mapping/security";
import type { OpenAPISchema, OpenAPIServer } from "../types";

import { OpenApiCache } from "./cache";
import { collect, type Registries } from "./collect";
import type { ModuleContributor } from "./define-module";
import { inferFromCollections } from "./infer-collections";
import { inferFromSingles } from "./infer-singles";
import { serialize, type SerializeFormat } from "./serialize";

export interface GenerateArgs {
  registries: Registries;
  modules: readonly ModuleContributor[];
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: readonly OpenAPIServer[];
  /**
   * Opaque fingerprint of the underlying registries. The route handler
   * computes this cheaply from registry change events (or a stable
   * collection-snapshot hash) and passes it in. Different `schemaHash`
   * values key independent cache entries; identical values short-circuit
   * to the cached buffer regardless of registry-call cost.
   */
  schemaHash: string;
  format: SerializeFormat;
}

export interface GenerateResult {
  body: Buffer;
  etag: string;
  contentType: "application/json" | "application/yaml";
}

// Module-level singleton. Capacity 4 keeps the common case (json+yaml
// across one schema transition) covered with a tiny memory footprint.
const cache = new OpenApiCache({ max: 4 });

export async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const cacheKey = computeCacheKey(args);
  const cached = cache.get(cacheKey);
  if (cached) return formatResult(cached, cacheKey, args.format);

  const raw = await collect({
    registries: args.registries,
    modules: args.modules,
  });

  const { operations: collectionOps, schemas: collectionSchemas } =
    inferFromCollections(raw.collections);
  const { operations: singleOps, schemas: singleSchemas } = inferFromSingles(
    raw.singles
  );

  const envelopes = buildEnvelopeComponents();
  const errors = buildErrorComponents();
  const security = buildSecuritySchemes();

  const schemas: Record<string, OpenAPISchema> = {
    ...envelopes.schemas,
    ...errors.schemas,
    ...collectionSchemas,
    ...singleSchemas,
  };

  const operations: OperationIR[] = [...collectionOps, ...singleOps];
  const tags: TagIR[] = [];

  // Merge module contributions. Later modules can override schema keys
  // emitted by earlier ones — the iteration order matches input order.
  for (const m of raw.modules) {
    operations.push(...m.operations);
    if (m.tag) tags.push(m.tag);
    if (m.schemas) Object.assign(schemas, m.schemas);
  }

  const doc: DocumentIR = {
    openapi: "3.1.0",
    info: args.info,
    servers: args.servers ?? [],
    tags,
    operations,
    components: {
      schemas,
      responses: errors.responses,
      parameters: {},
      requestBodies: {},
      securitySchemes: security.securitySchemes,
    },
    extensions: {},
  };

  const body = serialize(doc, args.format);
  cache.set(cacheKey, body);
  return formatResult(body, cacheKey, args.format);
}

function formatResult(
  body: Buffer,
  cacheKey: string,
  format: SerializeFormat
): GenerateResult {
  return {
    body,
    etag: `W/"${cacheKey}"`,
    contentType: format === "yaml" ? "application/yaml" : "application/json",
  };
}

function computeCacheKey(args: GenerateArgs): string {
  const fingerprint = JSON.stringify({
    schemaHash: args.schemaHash,
    info: args.info,
    servers: args.servers ?? null,
    modules: args.modules.map(m => m.name),
    format: args.format,
  });
  const hash = createHash("sha1").update(fingerprint).digest("hex");
  return `${hash}:${args.format}`;
}

/**
 * Test-only helper: wipes the singleton cache between test runs.
 *
 * Prefixed with `__` to discourage production callers; the route handler
 * never needs to call this (invalidation happens via `schemaHash` changes).
 */
export function __resetGenerateCacheForTests(): void {
  cache.clear();
}
