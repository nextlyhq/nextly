# @nextlyhq/plugin-api-docs

> Nextly is in alpha. APIs may change before 1.0.

First-party API documentation plugin for Nextly. **This plugin is the way to get OpenAPI docs** — install it and it does everything at request time: it scans your app's route files to discover where the API is mounted, pulls the admin REST operations through nextly's introspection seam, folds in every registered plugin's routes, assembles an OpenAPI 3.1 document (with the error component generated from the live error-code enum), and serves it plus an interactive **Scalar** reference.

It is **opt-in** and **framework-agnostic** (zero `next`/`react` dependency): the docs page is plain HTML served over the plugin route surface. Scalar ships as a real dependency and is served by the plugin itself (`GET …/scalar.js`) — no runtime CDN fetch, so docs work offline, inside sandboxed webviews, and without leaking doc views to a third party. Core nextly ships only two small read-only introspection seams this consumes — all OpenAPI knowledge lives here.

## Install

```bash
npm install @nextlyhq/plugin-api-docs
```

## Usage

Register the plugin in your Nextly config:

```ts
import { defineConfig } from "nextly/config";
import { apiDocsPlugin } from "@nextlyhq/plugin-api-docs";

export default defineConfig({
  plugins: [apiDocsPlugin()],
});
```

This contributes — served directly at the **admin API root** (not the plugin namespace):

- `GET /admin/api/docs` — an interactive Scalar reference (the docs page)
- `GET /admin/api/docs/spec.json` — the OpenAPI 3.1 document, generated on demand
- `GET /admin/api/docs/scalar.js` — the self-hosted Scalar bundle
- an **API Docs** entry in the admin sidebar linking to the docs page

The spec route is **admin-gated by default** (secure by default, like every plugin route). Set `visibility: "public"` to let anyone fetch the spec JSON.

## Options

| Option              | Default        | Description                                                                                                                          |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `docsPath`          | `"/docs"`      | Base path under the admin API root — set it in nextly.config to move the whole surface (e.g. `"/api-docs"` → `/admin/api/api-docs`). |
| `visibility`        | `"admin"`      | `"public"` makes the spec JSON publicly readable.                                                                                    |
| `label`             | `"API Docs"`   | Sidebar label.                                                                                                                       |
| `title`             | `"Nextly API"` | `info.title` in the generated document.                                                                                              |
| `mounts`            | —              | Explicit mount declarations that correct or add to the filesystem scan (for non-standard layouts).                                   |
| `excludePaths`      | —              | Glob patterns dropping paths from the spec.                                                                                          |
| `excludeServices`   | —              | Service names whose operations are dropped.                                                                                          |
| `excludeErrorCodes` | —              | Error codes dropped from the generated error component.                                                                              |

```ts
// Move the docs to /admin/api/api-docs:
apiDocsPlugin({ docsPath: "/api-docs" });
```

```ts
apiDocsPlugin({
  visibility: "public",
  title: "My Blog API",
  excludeServices: ["apiKeys"],
});
```

## How it works

At request time the plugin combines three sources:

1. **A filesystem scan** of your `app/` route files — where each nextly surface is mounted and which verbs it exports (this is how the media double-mount — auth'd CRUD vs public GET — is discovered automatically).
2. **The admin REST introspection seam** (`listAdminRestOperations` from nextly) — the catch-all's operations, verbs, paths, and auth modes.
3. **The plugin-route view** (`listPluginRoutes`) — every registered plugin's routes, derived with zero plugin action; a plugin can enrich its entries with an optional `openapi?` annotation (`{ summary, description, tags }`) on its routes.

The error component is generated from the live `NEXTLY_ERROR_STATUS` enum (all codes, grouped by status, with `x-request-id` / `retry-after` response headers) — never hand-listed.

## License

MIT
