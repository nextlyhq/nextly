/**
 * `@nextlyhq/plugin-api-docs` — the first-party API documentation plugin.
 *
 * THE way to get OpenAPI docs for a Nextly app: install this plugin and it does
 * everything at request time — scans the app's route files for where the API is
 * mounted, pulls the admin REST operations through the core introspection seam
 * (`listAdminRestOperations` via the plugin-sdk), folds in every registered
 * plugin's routes (`listPluginRoutes`), assembles an OpenAPI 3.1 document with
 * the enum-generated error component, and serves it plus an interactive Scalar
 * reference. Core ships only the two small read-only introspection seams this
 * consumes; all OpenAPI knowledge lives here.
 *
 * Opt-in and framework-agnostic: the docs page is plain HTML over the plugin
 * route surface (zero `next`/`react` coupling). Scalar ships as a real
 * dependency and is served by the plugin itself — no runtime CDN fetch, so the
 * docs work offline, inside sandboxed webviews, and without leaking admin
 * doc views to a third party.
 *
 * @module plugin
 * @since alpha
 */
import { createRequire } from "node:module";

import {
  definePlugin,
  isAuthenticatedApiRequest,
  listAdminRestOperations,
  listContentSurfaces,
  listPluginRoutes,
  type PluginContributions,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";

import { restOperationsToDocs } from "./descriptors";
import {
  applyExcludes,
  excludeOperationsByService,
  type ExcludeOptions,
} from "./excludes";
import type { ContentSurfaceLike, FieldLike } from "./fields";
import { generateOpenApiDocument, type ContentConfig } from "./generate";
import { applyMountOverrides, type MountOverride } from "./mount-overrides";
import { pluginRoutesToDocs } from "./plugin-routes";
import { scanAppDirectory } from "./scan";
// The Scalar standalone bundle, vendored as a build-time text asset. Imported
// (not fs-resolved) because the host app's bundler pulls this dist into its
// own graph: it statically analyzes literal require.resolve("@scalar/...")
// and fails, and import.meta.url points into the bundle, not this package.
// A string constant is inert data to every bundler.
import scalarBundleSource from "./vendor/scalar-standalone.js.txt";

// Read the version from package.json so the plugin's declared version can never
// drift from what ships (mirrors the other first-party plugins).
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

/** Options for {@link apiDocsPlugin}. */
export interface ApiDocsPluginOptions extends ExcludeOptions {
  /**
   * `'admin'` (default) serves the spec and docs admin-gated, under the plugin's
   * route namespace. `'public'` makes the SPEC publicly readable (anyone can
   * fetch the JSON); the docs page stays reachable but reflects whatever the
   * spec route allows.
   */
  visibility?: "admin" | "public";
  /** Sidebar label for the docs entry. Defaults to `"API Docs"`. */
  label?: string;
  /**
   * Base path the docs are served at, directly under the admin API root —
   * `"/docs"` (default) serves the page at `/admin/api/docs`, the spec at
   * `/admin/api/docs/spec.json`. Set it in nextly.config to move the whole
   * surface (e.g. `"/api-docs"` → `/admin/api/api-docs`). Must start with "/"
   * and must not name a system REST resource (refused at boot).
   */
  docsPath?: string;
  /** `info.title` in the generated document. Defaults to `"Nextly API"`. */
  title?: string;
  /** Explicit mount declarations correcting or adding to the filesystem scan. */
  mounts?: readonly MountOverride[];
}

const PLUGIN_NAME = "@nextlyhq/plugin-api-docs";
const DEFAULT_DOCS_PATH = "/docs";

/** Normalize a configured docs path: leading "/", no trailing "/". */
function normalizeDocsPath(raw: string | undefined): string {
  const path = (raw ?? DEFAULT_DOCS_PATH).replace(/\/+$/, "") || "/";
  if (!path.startsWith("/")) {
    throw new Error(
      `apiDocsPlugin: docsPath must start with "/" (got "${raw}")`
    );
  }
  return path;
}

/** Route paths under the admin API root, derived from the docs base path. */
function docsRoutePaths(docsPath: string): {
  docs: string;
  spec: string;
  scalar: string;
} {
  // A base of "/" would produce "//spec.json"; strip the trailing slash so the
  // root mount serves "/spec.json" and "/scalar.js".
  const base = docsPath.replace(/\/+$/, "");
  return {
    docs: docsPath,
    spec: `${base}/spec.json`,
    scalar: `${base}/scalar.js`,
  };
}

/** The full URL the spec route is served at (the Scalar page reads this). */
function specUrl(docsPath: string): string {
  return `/admin/api${docsRoutePaths(docsPath).spec}`;
}

/** The full URL the plugin-served Scalar bundle is at. */
function scalarJsUrl(docsPath: string): string {
  return `/admin/api${docsRoutePaths(docsPath).scalar}`;
}

/**
 * Render the docs page shell. Scalar boots from the plugin-served bundle
 * (`scriptUrl`) and reads the spec from `specUrl`; `data-url` is Scalar's
 * documented configuration attribute. Exported (and pure) so the page content is
 * testable without a request context.
 */
export function renderDocsHtml(specUrl: string, scriptUrl: string): string {
  // Escape for safe embedding inside double-quoted HTML attributes.
  const safeSpec = specUrl.replace(/"/g, "&quot;");
  const safeScript = scriptUrl.replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nextly API Docs</title>
</head>
<body>
<noscript>JavaScript is required to view the API documentation.</noscript>
<script id="api-reference" data-url="${safeSpec}"></script>
<script src="${safeScript}"></script>
</body>
</html>`;
}

/**
 * Project the host config's content surfaces (collections / singles /
 * field-groups) into the minimal shape the dynamic docs expansion reads:
 * slug, labels, fields. The config's field objects carry far more than the
 * docs need; only the wire-shaping options are projected.
 */
function toContent(config: unknown): ContentConfig {
  const project = (list: unknown): ContentSurfaceLike[] | undefined => {
    if (!Array.isArray(list)) return undefined;
    return list
      .filter(
        (s): s is Record<string, unknown> => typeof s === "object" && s !== null
      )
      .map(s => {
        const labels = s.labels as
          { singular?: string; plural?: string } | undefined;
        // A slug is a string (or number) by contract; anything else cannot be
        // named safely, and defaulting it to "[object Object]" would produce a
        // garbage path — skip instead.
        const rawSlug = s.slug ?? s.name;
        const slug =
          typeof rawSlug === "string" || typeof rawSlug === "number"
            ? String(rawSlug)
            : "";
        return {
          slug,
          labels: labels && typeof labels === "object" ? labels : undefined,
          fields: Array.isArray(s.fields) ? (s.fields as FieldLike[]) : [],
        };
      })
      .filter(s => s.slug.length > 0);
  };
  const cfg = (config ?? {}) as Record<string, unknown>;
  return {
    collections: project(cfg.collections),
    singles: project(cfg.singles),
    fieldGroups: project(cfg.fieldGroups),
  };
}

/**
 * Resolve the content surfaces for dynamic expansion. Prefers the RUNTIME
 * registry seam — it covers every origin (code-first, plugin-contributed, and
 * collections/singles created DYNAMICALLY through the admin Schema Builder,
 * read fresh from the database) — and falls back to the route context's config
 * when the registry services are not up (or genuinely empty).
 */
async function resolveContent(config: unknown): Promise<ContentConfig> {
  const surfaces = await listContentSurfaces();
  const fromRegistry: ContentConfig = {
    collections: surfaces.collections.map(c => ({
      slug: c.slug,
      labels: c.labels,
      fields: c.fields as FieldLike[],
    })),
    singles: surfaces.singles.map(s => ({
      slug: s.slug,
      labels: s.labels,
      fields: s.fields as FieldLike[],
    })),
  };
  const hasRegistryData =
    (fromRegistry.collections?.length ?? 0) > 0 ||
    (fromRegistry.singles?.length ?? 0) > 0;
  // field-groups only exist as config declarations; carry them from the config
  // view either way so component $refs keep resolving.
  const cfg = toContent(config);
  fromRegistry.fieldGroups = cfg.fieldGroups;
  return hasRegistryData ? fromRegistry : cfg;
}

/**
 * Assemble the OpenAPI document for THIS app, on demand. Reads the sources
 * (filesystem scan, admin REST seam, plugin routes, runtime content
 * registries), applies the service excludes before generation and the
 * path/code excludes after. On a published surface, an ANONYMOUS caller gets
 * the public-only view (gated operations and content shapes stay private);
 * a caller with a valid session/API key gets the full document.
 */
async function buildSpec(
  options: ApiDocsPluginOptions,
  config: unknown,
  req: Request
): Promise<Record<string, unknown>> {
  const scan = applyMountOverrides(
    scanAppDirectory(process.cwd()),
    options.mounts
  );
  // Service excludes filter the operation lists the generator consumes; path
  // and error-code excludes are applied to the assembled document.
  const restOperations = excludeOperationsByService(
    restOperationsToDocs(listAdminRestOperations()),
    options.excludeServices
  );
  const pluginOperations = excludeOperationsByService(
    pluginRoutesToDocs(listPluginRoutes()),
    options.excludeServices
  );
  const doc = generateOpenApiDocument({
    scan,
    restOperations,
    pluginOperations,
    // Runtime registries first (includes dynamically created content); the
    // config view is the fallback.
    content: await resolveContent(config),
    info: { title: options.title },
    // Anonymous viewers of a published spec see the public surface only. On an
    // admin-gated surface every caller already passed auth, so no filtering.
    publicOnly:
      options.visibility === "public" &&
      !(await isAuthenticatedApiRequest(req)),
  });
  return applyExcludes(doc, options);
}

/**
 * Create the API Docs plugin. Register it directly in your config:
 *
 * @example
 * ```ts
 * import { defineConfig } from "nextly/config";
 * import { apiDocsPlugin } from "@nextlyhq/plugin-api-docs";
 *
 * export default defineConfig({
 *   plugins: [apiDocsPlugin()],
 * });
 * ```
 *
 * Contributes the docs surface directly at the admin API root (default
 * `/admin/api/docs`, moved with `docsPath`): `GET <docsPath>` (the Scalar
 * reference page), `GET <docsPath>/spec.json` (the OpenAPI document), and
 * `GET <docsPath>/scalar.js` (the self-hosted bundle), plus a sidebar entry
 * linking to the docs page. All three are admin-gated by default;
 * `visibility: "public"` publishes the WHOLE surface (page + spec + bundle) —
 * publishing only the JSON would leave no way to read it.
 */
export function apiDocsPlugin(
  options?: ApiDocsPluginOptions
): PluginDefinition {
  const opts = options ?? {};
  const label = opts.label ?? "API Docs";
  const docsPath = normalizeDocsPath(opts.docsPath);
  const paths = docsRoutePaths(docsPath);
  const docsUrl = `/admin/api${docsPath}`;
  // Secure by default: admin-gated unless the operator explicitly publishes.
  // The page and bundle carry nothing the spec doesn't (an HTML shell and a
  // public OSS library), so publishing means the whole surface — otherwise a
  // logged-out visitor gets a 401 page for docs they were meant to read.
  const isPublic = opts.visibility === "public";

  const contributes: PluginContributions = {
    routes: [
      {
        method: "GET",
        path: paths.docs,
        // Served as a first-party admin API surface rather than under the
        // plugin namespace — `/admin/api/docs` reads as product, not as plugin
        // plumbing.
        mount: "admin-api",
        public: isPublic,
        handler: () =>
          new Response(
            renderDocsHtml(specUrl(docsPath), scalarJsUrl(docsPath)),
            {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            }
          ),
      },
      {
        method: "GET",
        path: paths.spec,
        mount: "admin-api",
        public: isPublic,
        handler: async (req, ctx) =>
          Response.json(await buildSpec(opts, ctx.config, req), {
            headers: { "cache-control": "no-store" },
          }),
      },
      {
        // The Scalar bundle, served same-origin by the plugin — the library
        // itself is public OSS, and the docs <script> fetch must succeed for
        // logged-out visitors on a published surface.
        method: "GET",
        path: paths.scalar,
        mount: "admin-api",
        public: isPublic,
        handler: () =>
          new Response(scalarBundleSource, {
            headers: {
              "content-type": "application/javascript; charset=utf-8",
              // Identical bytes on every serve; let the browser keep them.
              "cache-control": "private, max-age=86400",
            },
          }),
      },
    ],
    admin: {
      menu: [{ label, to: docsUrl, icon: "BookOpen" }],
    },
  };

  return definePlugin({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    nextly: ">=0.0.2-alpha.21",
    author: "Nextly <contact@nextlyhq.com> (https://nextlyhq.com)",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    category: "dev-tools",
    tags: ["openapi", "docs", "api", "scalar"],
    admin: {
      description:
        "Interactive Scalar API documentation for your app's generated OpenAPI spec",
    },
    contributes,
  });
}
