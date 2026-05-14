---
"nextly": minor
---

Add first-class OpenAPI 3.1 spec generation + Scalar docs UI.

Nextly now generates a complete, accurate OpenAPI 3.1 document from your
registered collections, singles, components, and built-in modules at
request time — no separate build step. Mount one Next.js catch-all route
and you get:

- `GET /admin/api/openapi/openapi.json` — JSON spec
- `GET /admin/api/openapi/openapi.yaml` — YAML spec
- `GET /admin/api/openapi` — interactive docs UI

**What's covered out of the box:**

- Every collection's six CRUD endpoints (list / find / create / update / delete / count)
- Every single's read + update endpoints
- 12 built-in modules: `health`, `auth`, `users`, `media` (incl. uploads + folders + presigned URLs), `email-providers`, `email-templates`, `email-send`, `components`, `singles`, `collections-schema`, `rbac`, `system` — 120+ documented endpoints total
- Canonical envelopes: `PaginationMeta`, `CountResponse`, `DeleteResponse`, `BulkItemError`, `BulkUploadItemError`
- Canonical `Error` schema (enum keyed off `NEXTLY_ERROR_STATUS`) and ten named error responses
- Three security schemes: `bearerAuth`, `cookieAuth`, `apiKeyAuth`
- Honest `oneOf` shapes for depth-dependent relationship + upload fields
- `multipart/form-data` request bodies on every upload endpoint
- Type-accurate request/response pairs for every endpoint, derived from the same field configs the runtime uses

**Configuration ([`defineOpenApi`](https://github.com/nextlyhq/nextly)):**

```ts
import { defineConfig, defineOpenApi } from "nextly";

export default defineConfig({
  collections: [Posts, Authors /* ... */],
  openapi: defineOpenApi({
    info: { title: "Acme API", version: "1.0.0" },
    servers: [{ url: "https://api.acme.com" }],
    cache: { maxAgeSeconds: 300 },
  }),
});
```

**Mounting the routes:**

```ts
// app/admin/api/openapi/[[...slug]]/route.ts
import { openApiHandler } from "nextly/api/openapi";
export const GET = openApiHandler.GET;
```

**Docs UI:**

Install `@scalar/api-reference` (optional peer dep) for the interactive
Scalar docs UI:

```bash
pnpm add @scalar/api-reference
```

Without it you still get a clean dependency-free fallback page that
links to the JSON + YAML spec and prints the install command. Swagger
UI and Redoc adapters land in Phase 2.

**Caching:**

The handler computes a fingerprint from each registry record's existing
`schemaHash` and pipes it through a small LRU cache. Identical
registries → identical buffer → instant 304 on `If-None-Match`. JSON
and YAML cache independently.

**Type-safe re-exports:**

The `nextly/openapi` subpath also re-exports curated `OpenAPIDocument`,
`OpenAPISchema`, `OpenAPIOperation` types and the pluggable
`DocsUiRenderer` interface for downstream tooling that wants to type
against the same surface.

Phase 2 will add per-collection / per-field `openapi:` override slots,
plugin contribution hooks, the `x-nextly-access` access-control
annotations, bundled-asset serving for Scalar, and Swagger UI / Redoc
renderers.
