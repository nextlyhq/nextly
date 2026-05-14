/**
 * Route handler for `admin/api/openapi/openapi.json` and `.yaml`.
 *
 * Re-export from your Next.js app under whatever path you mount the
 * OpenAPI docs at:
 *
 * @example
 * ```ts
 * // app/admin/api/openapi/openapi.json/route.ts
 * import { openApiHandler } from "nextly/api/openapi";
 * export const GET = openApiHandler.GET;
 *
 * // app/admin/api/openapi/openapi.yaml/route.ts
 * import { openApiHandler } from "nextly/api/openapi";
 * export const GET = openApiHandler.GET;
 * ```
 *
 * The handler dispatches based on the request path suffix
 * (`.json` vs `.yaml`), serves both representations from the same cache,
 * and supports conditional GET via the `If-None-Match` header.
 *
 * Phase 1 deliberately keeps the document `info` field bound to hardcoded
 * defaults (`Nextly API` / `1.0.0`). T24 introduces `defineOpenApi()`,
 * which threads user-supplied `info` / `servers` / module-list overrides
 * through this handler.
 *
 * @module nextly/api/openapi
 */

import { createHash } from "crypto";

import type { CollectionConfig } from "../collections/config/define-collection";
import type { ComponentConfig } from "../components/config/types";
import { getService, isServicesRegistered } from "../di";
import { NextlyError } from "../errors/nextly-error";
import type { Registries } from "../openapi/generator/collect";
import { generate } from "../openapi/generator/pipeline";
import { builtinModules } from "../openapi/modules";
import type { SingleConfig } from "../singles/config/types";

const FORMAT_BY_SUFFIX: Record<string, "json" | "yaml"> = {
  "/openapi.json": "json",
  "/openapi.yaml": "yaml",
  "/openapi.yml": "yaml",
};

function detectFormat(pathname: string): "json" | "yaml" | null {
  for (const [suffix, format] of Object.entries(FORMAT_BY_SUFFIX)) {
    if (pathname.endsWith(suffix)) return format;
  }
  return null;
}

/**
 * Adapter shim — the runtime registries return `Dynamic*Record` rows that
 * carry every field the generator reads (slug, labels, fields, …) but
 * also additional bookkeeping fields (id, schemaHash, migrationStatus,
 * …). Cast to the narrower `*Config` shape the pipeline expects.
 *
 * We keep the cast localized here so the generator stays decoupled from
 * the runtime record types. Future variants (build-time CLI snapshot,
 * test fixtures, plugin-supplied virtual collections) can supply their
 * own `Registries` without touching the pipeline.
 */
function buildRegistriesFromContainer(): Registries {
  const collections = getService("collectionRegistryService");
  const singles = getService("singleRegistryService");
  const components = getService("componentRegistryService");

  return {
    collections: {
      getAllCollections: async () =>
        (await collections.getAllCollections()) as unknown as readonly CollectionConfig[],
    },
    singles: {
      getAllSingles: async () =>
        (await singles.getAllSingles()) as unknown as readonly SingleConfig[],
    },
    components: {
      getAllComponents: async () =>
        (await components.getAllComponents()) as unknown as readonly ComponentConfig[],
    },
  };
}

/**
 * Compute a fingerprint for the current registry state.
 *
 * Each Dynamic*Record carries its own per-record `schemaHash` (the
 * upstream migration pipeline uses it for drift detection). Concatenating
 * those gives a cheap, stable fingerprint — when nothing changes the
 * hash is identical and the pipeline cache short-circuits.
 *
 * Records without a `schemaHash` field (older snapshots, in-memory test
 * fixtures) contribute their JSON-serialized fields instead.
 */
async function computeSchemaHash(registries: Registries): Promise<string> {
  const [collections, singles, components] = await Promise.all([
    registries.collections.getAllCollections(),
    registries.singles.getAllSingles(),
    registries.components.getAllComponents(),
  ]);

  const fp = (item: unknown): string => {
    const rec = item as {
      slug?: string;
      schemaHash?: string;
      fields?: unknown;
    };
    if (rec.schemaHash) return `${rec.slug}:${rec.schemaHash}`;
    return `${rec.slug}:${JSON.stringify(rec.fields ?? null)}`;
  };

  const parts = [
    ...collections.map(fp),
    "|",
    ...singles.map(fp),
    "|",
    ...components.map(fp),
  ];
  return createHash("sha1").update(parts.join("\n")).digest("hex");
}

async function handleGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const format = detectFormat(url.pathname);
  if (!format) {
    return new Response(
      JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message:
            "OpenAPI document not found. Mount the handler at " +
            "`/openapi.json` or `/openapi.yaml`.",
        },
      }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }

  if (!isServicesRegistered()) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "openapi handler called before registerServices() / getNextly()",
    });
  }

  const registries = buildRegistriesFromContainer();
  const schemaHash = await computeSchemaHash(registries);

  const result = await generate({
    registries,
    modules: [...builtinModules],
    info: {
      title: "Nextly API",
      version: "1.0.0",
    },
    schemaHash,
    format,
  });

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === result.etag) {
    return new Response(null, {
      status: 304,
      headers: { etag: result.etag },
    });
  }

  // `result.body` is a Node `Buffer`. The project's TS lib config doesn't
  // include Buffer in `BodyInit`, so decode to UTF-8 string here — the
  // generator only ever emits text payloads (JSON / YAML).
  const body = result.body.toString("utf8");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      etag: result.etag,
      "cache-control": "public, max-age=60, must-revalidate",
      vary: "accept, accept-encoding",
    },
  });
}

export const openApiHandler = {
  GET: handleGet,
};
