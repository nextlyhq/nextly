/**
 * Route handler for `admin/api/openapi/*` — spec + docs UI.
 *
 * Re-export from your Next.js app under whatever path you mount the
 * OpenAPI surface at:
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
 *
 * // app/admin/api/openapi/route.ts   <- docs UI
 * import { openApiHandler } from "nextly/api/openapi";
 * export const GET = openApiHandler.GET;
 * ```
 *
 * The handler dispatches on the request path suffix:
 *   /openapi.json  → JSON spec
 *   /openapi.yaml  → YAML spec
 *   /openapi.yml   → YAML spec (alias)
 *   anything else  → docs UI page (HTML)
 *
 * It pulls `info`, `servers`, `cache`, and `ui` overrides from the
 * `openapi` slot in `defineConfig({...})`; missing values fall back to
 * the package defaults (`"Nextly API"` / `"1.0.0"`, default cache
 * windows, Scalar UI when installed).
 *
 * @module nextly/api/openapi
 */

import { createHash } from "crypto";

import type { CollectionConfig } from "../collections/config/define-collection";
import type { ComponentConfig } from "../components/config/types";
import { getService, isServicesRegistered } from "../di";
import { NextlyError } from "../errors/nextly-error";
import type { OpenApiConfig } from "../openapi";
import type { Registries } from "../openapi/generator/collect";
import { generate } from "../openapi/generator/pipeline";
import { builtinModules } from "../openapi/modules";
import { fallbackRenderer } from "../openapi/renderer/fallback";
import type { DocsUiRenderer } from "../openapi/renderer/interface";
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

function readOpenApiConfig(): OpenApiConfig {
  try {
    const cfg = getService("config");
    return cfg.openapi ?? {};
  } catch {
    // DI "config" service may not be registered in lightweight contexts
    // (e.g. direct dispatcher tests). Fall back to package defaults
    // rather than throwing — the spec endpoint still works without
    // any user overrides.
    return {};
  }
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

/**
 * Resolve the configured docs renderer.
 *
 * `"scalar"` (and the default `undefined` choice) tries to dynamically
 * import `../openapi/renderer/scalar`. When the module isn't built yet
 * (Phase 1) or `@scalar/api-reference` isn't installed, the fallback
 * renderer takes over. Swagger UI / Redoc adapters land in Phase 2;
 * for now those values also fall back so the page still renders.
 */
async function resolveRenderer(
  name?: OpenApiConfig["ui"]
): Promise<DocsUiRenderer> {
  if (name === undefined || name === "scalar") {
    // The scalar adapter is loaded dynamically so the peer dep stays
    // optional. T25 ships the module; until then this import throws and
    // we land on the fallback. The specifier is held in a variable so
    // TS doesn't try to statically resolve it at compile time.
    const specifier = "../openapi/renderer/scalar";
    try {
      const mod = (await import(specifier)) as {
        scalarRenderer?: DocsUiRenderer;
      };
      if (mod.scalarRenderer) return mod.scalarRenderer;
    } catch {
      // Module missing or `@scalar/api-reference` peer dep not installed.
    }
  }
  return fallbackRenderer;
}

function makeCacheControl(cache: OpenApiConfig["cache"]): string {
  const enabled = cache?.enabled !== false;
  if (!enabled) return "no-store";
  const maxAge = Math.max(0, Math.floor(cache?.maxAgeSeconds ?? 60));
  return `public, max-age=${maxAge}, must-revalidate`;
}

async function handleSpec(
  req: Request,
  format: "json" | "yaml",
  config: OpenApiConfig
): Promise<Response> {
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
      title: config.info?.title ?? "Nextly API",
      version: config.info?.version ?? "1.0.0",
      ...(config.info ?? {}),
    },
    servers: config.servers,
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

  const body = result.body.toString("utf8");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      etag: result.etag,
      "cache-control": makeCacheControl(config.cache),
      vary: "accept, accept-encoding",
    },
  });
}

async function handleDocsUi(
  req: Request,
  config: OpenApiConfig
): Promise<Response> {
  const url = new URL(req.url);
  // Drop a trailing slash and append the JSON spec sibling so the
  // renderer can fetch it directly from the same mount point.
  const pathname = url.pathname.replace(/\/$/, "");
  const specUrl = new URL(`${pathname}/openapi.json`, url).toString();

  const renderer = await resolveRenderer(config.ui);
  const { html } = renderer.render({
    specUrl,
    title: config.info?.title ?? "Nextly API",
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": makeCacheControl(config.cache),
    },
  });
}

async function handleGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const config = readOpenApiConfig();
  const format = detectFormat(url.pathname);

  if (format) {
    return handleSpec(req, format, config);
  }

  return handleDocsUi(req, config);
}

export const openApiHandler = {
  GET: handleGet,
};
