# Nextly OpenAPI / Swagger Support — Design Spec

**Date:** 2026-05-12
**Status:** Approved (sections 1–5)
**Target release:** alpha → beta → 1.0 (phased; see §13)
**Owners:** Nextly core team
**Tracking:** TBD

---

## 1 · Summary

Add first-class OpenAPI 3.1 documentation to Nextly's REST API. The generated document describes every HTTP surface the framework exposes — auto-generated collection/single CRUD, all built-in modules (auth, media, email, components, etc.), and custom endpoints declared by users and plugins — and is served alongside an interactive UI (Scalar by default) at `admin/api/openapi`.

The design prefers **inference over configuration**: a zero-config Nextly app produces complete, accurate docs from existing collection and field metadata. An optional `openapi:` slot on each config layer carries opt-in overrides. Generation is **runtime with `schemaHash`-keyed caching**, supporting both code-first collections and visual-builder collections in one code path. Plugin extensibility is **two-layered** — a structured `contribute()` for additive merges and a final-pass `transform()` for arbitrary mutation.

This spec covers architecture, module layout, public API, field-type mapping, security/access modeling, versioning, renderer integration, performance, testing, migration, and risks.

---

## 2 · Goals & Non-Goals

### 2.1 Goals

1. **Production-grade OpenAPI 3.1 document** generated automatically from existing Nextly metadata.
2. **Full HTTP coverage** — auto-generated CRUD plus the ~30 built-in `api/*` subpaths plus custom plugin/app endpoints.
3. **Inference-first authoring** — zero added config produces complete docs; overrides are opt-in.
4. **Strong TypeScript surface** — every override slot typed, every public API exported with explicit types.
5. **Visual-builder parity** — UI-built collections are documented identically to code-first ones.
6. **Plugin extensibility** — third-party plugins can contribute schemas, security schemes, tags, and operations, and can transform the final document.
7. **Pluggable docs UI** — Scalar default, swap to Swagger UI / Redoc via single config flag.
8. **No external service dependencies** — entire stack self-hosted, no SaaS calls.

### 2.2 Non-Goals

1. **Documenting the Direct API** (`nextly.find()`, `nextly.create()`). It's in-process; out of scope.
2. **Mandating decorators or class-based controllers.** Nextly is config-object-based.
3. **JSON Schema as runtime validation source.** Zod stays the validator; JSON Schema is downstream output.
4. **GraphQL schema generation.** Separate concern, separate spec if pursued.
5. **Code generation of TypeScript types** (the existing type-gen flow stays unchanged; OpenAPI is downstream consumers' source of truth).
6. **API versioning via URL paths** in v1 (`/api/v1/...`). Reserved for future; v1 declares `info.version: "1.0.0"` only.

---

## 3 · Context & Existing Substrate

This section captures the relevant existing architecture that the design builds on. (Full architecture map produced 2026-05-12; this is the digest.)

### 3.1 What's already in place

| Capability              | Location                                                                          | What it gives us                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Collection Registry** | `packages/nextly/src/domains/collections/services/collection-registry-service.ts` | All collections (code-first AND visual-builder) accessible via one service. `schemaHash` change detection.                                                                              |
| **Single Registry**     | `packages/nextly/src/services/singles/single-registry-service.ts`                 | Same pattern for singles.                                                                                                                                                               |
| **Component Registry**  | `packages/nextly/src/services/components/component-registry-service.ts`           | Same pattern for polymorphic components.                                                                                                                                                |
| **Response envelopes**  | `packages/nextly/src/api/response-shapes.ts`                                      | Eight canonical shapes: `respondList`, `respondDoc`, `respondMutation`, `respondAction`, `respondData`, `respondCount`, `respondBulk`, `respondBulkUpload`. Reusable as OAS components. |
| **Unified error class** | `packages/nextly/src/errors/nextly-error.ts`                                      | Single `NextlyError` with closed enum of codes mapped to HTTP statuses. Reusable as OAS `Error` schema.                                                                                 |
| **Field configs**       | `packages/nextly/src/collections/fields/types/base.ts` and per-type files         | 17 field types with `validation` metadata that maps cleanly to JSON Schema.                                                                                                             |
| **Zod validation**      | Per-collection Zod schemas, Zod 4.1.x                                             | `z.toJSONSchema()` available natively in Zod 4. Used for cross-validation.                                                                                                              |
| **Plugin system**       | `packages/nextly/src/plugins/plugin-context.ts`                                   | `init()` lifecycle + collection contribution. Will be extended with an `openapi` field.                                                                                                 |
| **Route handler**       | `packages/nextly/src/route-handler/route-parser.ts`                               | Next.js handler that generates the actual routes. The OpenAPI generator observes its output rather than driving it.                                                                     |
| **Auth strategies**     | `packages/nextly/src/auth/middleware/`                                            | JWT, cookie session, API key — map to OAS `securitySchemes`.                                                                                                                            |

### 3.2 What's missing today

- No OpenAPI artifact of any kind. Greps return nothing.
- No API versioning (`/api/v1/...`).
- No `openapi:` slot on configs.
- No plugin contract field for OAS contributions.
- No documentation UI mounted anywhere.

### 3.3 Competitive landscape (digest)

| Project         | OpenAPI status                                                                           | Approach                                                            | Coverage                                                          |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Strapi**      | Official `@strapi/plugin-documentation`, marked **stale** in own docs                    | Read content-types + routes at startup; regenerate via admin button | Content-types + opt-in plugins; OAS 3.0                           |
| **Payload CMS** | Two community plugins (`payload-oapi` v0.2.5, `payload-openapi` v1.4.0); no core support | Read `payloadConfig` at runtime                                     | Collections, globals, auth; `payload-oapi` lacks custom endpoints |
| **Directus**    | Built-in `/server/specs/oas`                                                             | Runtime generation from collection schemas                          | CRUD only                                                         |
| **NestJS**      | Official `@nestjs/swagger` v11                                                           | Decorator-driven via class metadata                                 | Whatever controllers/DTOs the user annotates                      |

The landscape is genuinely weak; nobody has a complete solution that covers visual-builder + custom endpoints + plugin extensibility. This is the differentiation Nextly is targeting.

---

## 4 · Decisions Log

Each decision below is **frozen** for v1 unless explicitly revisited. The rationale captures _why_ — so future contributors can judge edge cases without re-litigating.

| #   | Decision                                                                                                               | Why                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Scope = everything HTTP** (auto-CRUD + built-in modules + custom endpoints; Direct API out of scope)                 | Direct API is in-process; OpenAPI describes wire formats. Anything reachable via HTTP must be in the spec.                                                              |
| 2   | **Runtime generation with `schemaHash`-keyed caching** (not build-time)                                                | Visual-builder collections can change at runtime. Single code path serves both code-first and UI-built collections. Cold-gen target < 80 ms makes runtime cheap enough. |
| 3   | **Subpath in core `nextly`** (not separate package, not plugin)                                                        | Generator needs deep registry access. Subpath matches existing pattern (`nextly/auth`, `nextly/errors`). Optional peer deps for renderers keep core install small.      |
| 4   | **Mount at `admin/api/openapi`** (not `/api/openapi`)                                                                  | Namespaces docs under admin path; clear separation from public API surface.                                                                                             |
| 5   | **Scalar as default renderer**, with `DocsUiRenderer` swap-out interface                                               | Smaller bundle (~120 KB gz vs ~400 KB), modern UX, themable, multi-language code samples. Interface allows future swap without API break.                               |
| 6   | **Inference-first + optional `openapi:` slot** on each config layer                                                    | 80% of doc quality comes from existing metadata. Override slot only for the remaining 20%.                                                                              |
| 7   | **`info.version` + `deprecated` + multi-version generator scaffolding** (no URL versioning yet)                        | Adding `/v1/` retroactively would break every existing client. Reserve the structure for v2 when the cost is justified.                                                 |
| 8   | **Honest `oneOf: [string, Doc]` for relationship/upload** response shapes                                              | Truthful, Scalar renders unions well, accurate examples can show both forms.                                                                                            |
| 9   | **Single spec with `x-nextly-access` annotations** (not role-aware multi-spec)                                         | Function-based access rules aren't statically introspectable. Annotations are advisory; server is source of truth.                                                      |
| 10  | **Plugin extensibility = contribute + transform** (two layers)                                                         | `contribute()` for predictable additive merges, `transform()` for arbitrary final-pass mutation. Standard pattern in mature OSS frameworks.                             |
| 11  | **Public docs by default** (`openapi.access.json: 'public'`)                                                           | OSS projects often want Stripe/Twilio-style public docs. User-chosen with full awareness of info-disclosure tradeoff.                                                   |
| 12  | **Override slot granularity = per-CRUD-verb** (`operations.{list,create,update,...}.{summary,description,deprecated}`) | Covers ~95% of real overrides. Finer (per-status-code) is opt-in via `responses` on custom endpoints only.                                                              |
| 13  | **CustomEndpoint `requestBody.schema` accepts both Zod and raw OpenAPI**                                               | Zod is the happy path (doubles as validation). Raw schema is the escape hatch for legacy/external cases.                                                                |
| 14  | **Built-in module security is locked** — `transform()` can add to but not weaken framework auth declarations           | Spec accuracy is a framework correctness property. One bad transform = thousands of downstream broken consumers.                                                        |
| 15  | **Renderer libs are optional peer deps** with graceful fallback HTML                                                   | Matches Nextly's adapter pattern. Serverless deployment-size friendly. README installs Scalar alongside core; users don't notice it's optional.                         |

---

## 5 · Architecture Overview

### 5.1 Module layout (inside `packages/nextly/src/`)

```
openapi/
├── index.ts                    # public API: defineOpenApi, override types
├── generator/
│   ├── pipeline.ts             # orchestrates phases below
│   ├── collect.ts              # reads registries → IR
│   ├── infer.ts                # IR → operations + schemas
│   ├── merge.ts                # plugin contribute + app-level overrides
│   ├── transform.ts            # transform hooks (plugin → app)
│   ├── validate.ts             # final OAS 3.1 validity check
│   ├── serialize.ts            # IR → JSON / YAML
│   ├── cache.ts                # schemaHash-keyed LRU cache, invalidation
│   └── define-module.ts        # helper used by built-in modules
├── mapping/
│   ├── fields/                 # one file per field type
│   │   ├── text.ts
│   │   ├── number.ts
│   │   ├── select.ts
│   │   ├── relationship.ts
│   │   ├── upload.ts
│   │   ├── richtext.ts
│   │   ├── array.ts
│   │   ├── group.ts
│   │   ├── component.ts
│   │   ├── json.ts
│   │   ├── ...
│   │   └── index.ts            # mapper registry
│   ├── envelopes.ts            # respondList/Doc/Mutation/... → components/schemas
│   ├── errors.ts               # NextlyError code map → Error component + responses
│   └── security.ts             # auth strategies → securitySchemes
├── modules/                    # built-in API module contributors
│   ├── auth.ts                 # /api/auth/*
│   ├── users.ts                # /api/users/*
│   ├── media.ts                # /api/media, /api/uploads, /api/media-*, storage-upload-url
│   ├── email-providers.ts
│   ├── email-templates.ts
│   ├── email-send.ts
│   ├── components.ts           # /api/components
│   ├── singles.ts              # /api/singles
│   ├── collections-schema.ts
│   ├── rbac.ts                 # roles, permissions, api-keys
│   ├── health.ts
│   └── system.ts               # everything else
├── ir/
│   ├── types.ts                # Operation, Schema, SecurityRequirement, etc.
│   └── builders.ts             # IR construction helpers
├── renderer/
│   ├── interface.ts            # DocsUiRenderer
│   ├── scalar.ts               # default renderer
│   ├── swagger-ui.ts           # alt renderer
│   ├── redoc.ts                # alt renderer
│   └── fallback.ts             # built-in HTML shown when renderer not installed
└── __tests__/
    ├── e2e.test.ts
    ├── pipeline.test.ts
    └── snapshots/
```

Plus one entry alongside existing route handlers:

```
api/
└── openapi.ts                  # the GET handler for admin/api/openapi/*
```

### 5.2 Package exports

Added to `packages/nextly/package.json` exports:

```json
{
  "./openapi": {
    "types": "./dist/openapi/index.d.ts",
    "import": "./dist/openapi/index.mjs"
  },
  "./api/openapi": {
    "types": "./dist/api/openapi.d.ts",
    "import": "./dist/api/openapi.mjs"
  }
}
```

Both ESM, server-only. Renderer assets served as static files from the route handler.

### 5.3 Runtime data flow

```
Request: GET /admin/api/openapi/openapi.json
   │
   ▼
[api/openapi.ts handler]
   │  resolves config + schemaHash from registries
   ▼
[generator/cache.ts]  ─── hit? ──► return cached buffer
   │ miss
   ▼
[generator/pipeline.ts]
   │
   ├─ collect.ts   ── reads CollectionRegistry / SingleRegistry /
   │                  ComponentRegistry / built-in module contributions
   │                  → produces IR
   │
   ├─ infer.ts     ── per-collection: field configs + envelopes → schemas;
   │                  CRUD path templates → operations;
   │                  emits x-nextly-access annotations
   │
   ├─ merge.ts     ── plugin `openapi.contribute()` → merge into IR;
   │                  app-level `defineOpenApi.contribute` → merge last
   │
   ├─ transform.ts ── plugin transforms (in registration order) →
   │                  app transform (last word);
   │                  enforce built-in security lock
   │
   ├─ validate.ts  ── final OAS 3.1 schema check;
   │                  throws NextlyError in dev, warns in prod
   │
   └─ serialize.ts ── IR → JSON or YAML buffer
   │
   ▼
[cache.ts] → store by `schemaHash + configHash + pluginsHash + format`
   │
   ▼
Response: application/json (or yaml), ETag = hash
```

### 5.4 Cache invalidation triggers

1. **Schema events** — `CollectionRegistry` / `SingleRegistry` / `ComponentRegistry` already emit change events on code-first sync or visual-builder save. The OpenAPI cache subscribes and invalidates affected entries.
2. **Plugin/config reload** — on hot reload (dev), cache flushes globally.
3. **ETag mismatch** — handled at the HTTP layer (304 Not Modified), independent of the generator.

---

## 6 · Public API Surface

### 6.1 Mounting the docs

In a Nextly user's app:

```ts
// app/admin/api/openapi/[[...slug]]/route.ts
import { openApiHandler } from "nextly/api/openapi";
export const { GET } = openApiHandler;
```

This single line mounts:

- `GET admin/api/openapi/openapi.json` — the spec (JSON)
- `GET admin/api/openapi/openapi.yaml` — same spec, YAML form
- `GET admin/api/openapi` — Scalar UI shell (or configured renderer)
- `GET admin/api/openapi/_assets/*` — renderer's static assets (CSS, JS, fonts)

### 6.2 Top-level configuration — `defineOpenApi()`

Exported from `nextly/openapi`. Entirely optional.

```ts
import { defineConfig } from "nextly/config";
import { defineOpenApi } from "nextly/openapi";

export default defineConfig({
  collections: [Posts, Users, Media],
  openapi: defineOpenApi({
    // Standard OAS `info`. All fields optional; sensible defaults from package.json.
    info: {
      title: "Acme CMS API",
      version: "1.0.0",
      description: "Public + admin REST API for Acme.",
      contact: { email: "api@acme.com" },
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },

    // Auto-detected if omitted (uses request Host + protocol at runtime).
    servers: [
      { url: "https://api.acme.com", description: "Production" },
      { url: "http://localhost:3000", description: "Local" },
    ],

    // Who can view the docs themselves.
    access: {
      json: "public", // 'admin' | 'public' | (req) => boolean
      ui: "public",
    },

    // Renderer choice — Scalar is the default if omitted.
    ui: "scalar", // 'scalar' | 'swagger-ui' | 'redoc' | DocsUiRenderer

    // Optional: explicit tag definitions. Auto-derived from collection labels otherwise.
    tags: [
      { name: "Posts", description: "Articles, drafts, editorial content." },
      { name: "Commerce", description: "Orders, products, checkout." },
    ],

    // Additive contribution — same shape plugins use.
    contribute: ({ env }) => ({
      securitySchemes: {
        myOAuth: {
          type: "oauth2",
          flows: {
            /* ... */
          },
        },
      },
      tags: [{ name: "Custom", description: "App-specific endpoints." }],
    }),

    // Final-pass transform; full doc, last word.
    transform: (doc, ctx) => {
      doc.info["x-nextly-build-sha"] = process.env.GIT_SHA;
      return doc;
    },

    // Operational knobs.
    cache: {
      enabled: true,
      maxAgeSeconds: 60,
    },
    rateLimit: {
      json: "60/minute/ip", // null disables
      ui: "120/minute/ip",
    },
    validate: "dev-only", // 'dev-only' (default) | 'always' | 'never'
    include: {
      builtinModules: true,
      customEndpoints: true,
    },
    exclude: {
      collections: ["internal-audit-log"], // never document these
      paths: ["/api/_internal/*"],
    },
    dialect: "3.1", // '3.1' (default) | '3.0' — for legacy tooling
  }),
});
```

Minimum useful config: `defineOpenApi({ info: { title, version } })`. Minimum legal config: `defineOpenApi()` with no argument.

### 6.3 `openapi?` slot on Collection / Single

```ts
defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  description: "Editorial articles.",
  fields: [
    /* ... */
  ],

  openapi: {
    tag: "Editorial", // override default tag (collection.labels.plural)
    deprecated: false,
    externalDocs: { url: "https://docs.acme.com/posts" },
    hidden: false, // true → omit entirely from spec

    // Per-schema-variant examples. Keys must match generated schema names
    // (see §7.3): `<Slug>`, `Create<Slug>`, `Update<Slug>`.
    examples: {
      Post: {
        id: "post_01",
        title: "Hello",
        status: "published",
        author: { id: "usr_01", name: "Sam" },
      }, // populated form
      CreatePost: { title: "My new post", status: "draft", author: "usr_01" },
      UpdatePost: { status: "published" },
    },

    // Per-CRUD-verb overrides
    operations: {
      list: { summary: "List articles", description: "...", deprecated: false },
      findById: { summary: "Get article by ID" },
      create: { summary: "Author a new article" },
      update: { summary: "Edit an article" },
      delete: { summary: "Archive an article (soft delete)" },
      count: { summary: "Count matching articles" },
    },
  },
});
```

### 6.4 `openapi?` slot on Fields

```ts
text({
  name: "slug",
  required: true,
  validation: { pattern: "^[a-z0-9-]+$", minLength: 3, maxLength: 80 },
  openapi: {
    description: "URL-safe identifier, lowercase, dash-separated.",
    example: "my-first-post",
    format: "slug", // free-form format hint
    deprecated: false,
    writeOnly: false,
    readOnly: false,
    hidden: false, // true → omit field from generated schemas
    externalDocs: { url: "https://..." },
  },
});
```

**Automatic inferences** (you don't write these):

- `password` fields → `writeOnly: true`, omitted from response schemas
- `id`, `createdAt`, `updatedAt` → `readOnly: true`
- `field.admin.hidden: true` → not omitted by default, but flagged in field-name sensitivity warning if it matches `/password|secret|token|apiKey/i`
- `collection.admin.hidden: true` → entire collection omitted from spec

### 6.5 `openapi?` slot on CustomEndpoint

The most expressive — custom endpoints have no schemas to infer.

```ts
import { z } from "zod";

defineCollection({
  slug: "orders",
  fields: [
    /* ... */
  ],
  endpoints: [
    {
      path: "/cancel/:id",
      method: "POST",
      handler: cancelOrderHandler,
      openapi: {
        summary: "Cancel an order",
        description: "Soft-cancels an order. Inventory is restocked async.",
        tags: ["Commerce"],

        // Path/query/header parameters
        params: {
          path: { id: { type: "string", description: "Order ID" } },
          query: { reason: { type: "string", required: false } },
          header: {},
        },

        // Request body — Zod schema OR raw OpenAPI schema
        requestBody: {
          required: true,
          schema: z.object({ reason: z.string().optional() }), // Zod path
          // OR: schema: { type: 'object', properties: { reason: { type: 'string' } } }  // raw OAS path
          examples: {
            byCustomer: { reason: "Changed mind" },
            byAdmin: { reason: "Fraud" },
          },
        },

        // Responses by status code
        responses: {
          200: {
            schema: { $ref: "#/components/schemas/OrderMutationResponse" },
          },
          409: { $ref: "#/components/responses/Conflict" },
          // 401/403/500 auto-added by convention
        },

        security: ["bearerAuth", "apiKey"],
        deprecated: false,
        hidden: false,
      },
    },
  ],
});
```

When `schema` is a Zod schema, it doubles as runtime validation — same schema validates input AND documents it. When it's a raw OAS schema, the user is responsible for separate validation.

### 6.6 Plugin contract extension

The existing `PluginDefinition` interface gets one optional, additive field:

```ts
// packages/nextly/src/plugins/types.ts (extension)
export interface PluginDefinition {
  // ... existing fields unchanged
  openapi?: {
    /** Additive merge into the spec. Runs after core generation. */
    contribute?: (ctx: PluginOpenApiContext) => {
      schemas?: Record<string, OpenAPISchema>;
      responses?: Record<string, OpenAPIResponse>;
      parameters?: Record<string, OpenAPIParameter>;
      requestBodies?: Record<string, OpenAPIRequestBody>;
      securitySchemes?: Record<string, OpenAPISecurityScheme>;
      tags?: OpenAPITag[];
      servers?: OpenAPIServer[];
    };
    /** Final-pass mutation. Receives full doc. */
    transform?: (
      doc: OpenAPIDocument,
      ctx: PluginOpenApiContext
    ) => OpenAPIDocument | void;
  };
}

export interface PluginOpenApiContext {
  pluginName: string;
  /** Read-only registry snapshots. */
  collections: ReadonlyArray<CollectionConfig>;
  singles: ReadonlyArray<SingleConfig>;
  components: ReadonlyArray<ComponentConfig>;
  /** Current Nextly version. */
  version: string;
  /** Process env (frozen). */
  env: Readonly<Record<string, string | undefined>>;
}
```

**Merge order** (deterministic, documented):

1. Core generator emits base spec from registries.
2. Plugin `contribute()` merged in plugin registration order (later wins on key conflicts; warning logged).
3. App-level `defineOpenApi.contribute` merged last (always wins).
4. Plugin `transform()` calls run in registration order.
5. App-level `defineOpenApi.transform` runs last.

### 6.7 Published types

From `nextly/openapi`:

```ts
export { defineOpenApi };
export type {
  // Override slot types
  CollectionOpenApiOverrides,
  SingleOpenApiOverrides,
  FieldOpenApiOverrides,
  CustomEndpointOpenApiOverrides,

  // App-level config
  OpenApiConfig,

  // Plugin extension
  PluginOpenApiContext,

  // OAS types (re-exported for ergonomics in contribute/transform)
  OpenAPIDocument,
  OpenAPISchema,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIResponse,
  OpenAPIRequestBody,
  OpenAPISecurityScheme,
  OpenAPITag,
  OpenAPIServer,

  // Renderer
  DocsUiRenderer,
};
```

The full OAS 3.1 type universe is **not** re-exported — only the surface authors actually touch. Internal IR types stay internal.

### 6.8 Deliberate non-features

- **No decorators.** Nextly is config-object-based.
- **No JSDoc-tag mining.** Visual-builder collections have no source comments.
- **No sidecar `*.openapi.ts` files.** Single source of truth = the config object.
- **No environment-conditional config inside `openapi:` slots.** Authors put conditionals around `defineOpenApi(...)` in user code, not inside the slot shape (keeps slot data serializable).

---

## 7 · Field-Type → JSON Schema Mapping

One file per field type under `openapi/mapping/fields/`. Each exports a single function:

```ts
type FieldMapper<F extends FieldConfig> = (
  field: F,
  ctx: MappingContext
) => { input: OpenAPISchema; output: OpenAPISchema };

interface MappingContext {
  /** Used for $ref'ing other collections/components. */
  schemaRef: (name: string) => { $ref: string };
  /** Current collection slug (for naming nested schemas). */
  ownerSlug: string;
  /** Current field path (e.g., 'fields[3].blocks[0]' — for diagnostic warnings). */
  fieldPath: string;
}
```

### 7.1 Mapping table — all 17 field types

| Field type                           | Input schema                                                                                        | Output schema                                                                            | Notes                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `text`                               | `{ type: 'string', minLength?, maxLength?, pattern? }`                                              | same                                                                                     | Mirrors `validation`                                                             |
| `textarea`                           | `{ type: 'string', minLength?, maxLength? }`                                                        | same                                                                                     | No `format`                                                                      |
| `email`                              | `{ type: 'string', format: 'email' }`                                                               | same                                                                                     |                                                                                  |
| `password`                           | `{ type: 'string', minLength: 8, writeOnly: true }`                                                 | **omitted from response schema**                                                         | Hashed server-side                                                               |
| `code`                               | `{ type: 'string', x-nextly-code-language: <lang> }`                                                | same                                                                                     | Language hint via extension                                                      |
| `richText`                           | Lexical state: `{ type: 'object', x-nextly-richtext: { editor: 'lexical' } }` (free-form JSON tree) | `{ type: 'object', properties: { html: { type: 'string' }, json: { type: 'object' } } }` | Asymmetric: write JSON, read HTML+JSON. Confirmed with project owner 2026-05-12. |
| `number` (float)                     | `{ type: 'number', minimum?, maximum?, multipleOf? }`                                               | same                                                                                     |                                                                                  |
| `number` (integer)                   | `{ type: 'integer', minimum?, maximum? }`                                                           | same                                                                                     | Picked when `validation.step === 1` or all min/max are integers                  |
| `checkbox`                           | `{ type: 'boolean' }`                                                                               | same                                                                                     | If `hasMany`: array of boolean                                                   |
| `date`                               | `{ type: 'string', format: 'date-time' }`                                                           | same                                                                                     | ISO 8601                                                                         |
| `select` (single)                    | `{ type: 'string', enum: [...] }`                                                                   | same                                                                                     | `enum` from `options[].value`                                                    |
| `select` (multi)                     | `{ type: 'array', items: { type: 'string', enum: [...] } }`                                         | same                                                                                     |                                                                                  |
| `radio`                              | `{ type: 'string', enum: [...] }`                                                                   | same                                                                                     | Same as single `select`                                                          |
| `chips`                              | `{ type: 'array', items: { type: 'string' } }` (or `'number'`)                                      | same                                                                                     |                                                                                  |
| `upload`                             | `{ type: 'string', description: 'Media ID' }`                                                       | `{ oneOf: [{ type: 'string' }, $ref('Media')] }`                                         | Honest oneOf for depth-dependent shape                                           |
| `relationship` (single)              | `{ type: 'string' }`                                                                                | `{ oneOf: [{ type: 'string' }, $ref('<RelationTo>')] }`                                  |                                                                                  |
| `relationship` (hasMany)             | `{ type: 'array', items: { type: 'string' } }`                                                      | `{ oneOf: [array<string>, array<$ref>] }`                                                |                                                                                  |
| `relationship` (polymorphic)         | `{ type: 'string', x-nextly-relation-to: [...] }`                                                   | `{ oneOf: [{ type: 'string' }, $ref('A'), $ref('B'), ...] }`                             | Polymorphic relation hint via extension                                          |
| `array` (repeater)                   | `{ type: 'array', items: $ref('<ParentSlug>__<FieldName>Item') }`                                   | same                                                                                     | Item schema named per parent+field                                               |
| `group`                              | inline `{ type: 'object', properties: {...}, required: [...] }`                                     | same                                                                                     | Inlined (no semantic identity beyond parent)                                     |
| `json`                               | If `validation.schema` (Zod): `z.toJSONSchema(field.validation.schema)`. Otherwise `{}` (any JSON). | same                                                                                     |                                                                                  |
| `component` (single slot)            | `$ref('<ComponentSlug>')`                                                                           | same                                                                                     |                                                                                  |
| `component` (multi, of N registered) | `{ oneOf: [...registered], discriminator: { propertyName: '__component' } }`                        | same                                                                                     | OAS 3.1 polymorphism                                                             |
| `join` (virtual)                     | **omitted from input**                                                                              | depth-dependent output                                                                   | Computed at read time                                                            |

### 7.2 System fields auto-added per collection

- `id`: `{ type: 'string', readOnly: true }` (or `'integer'` if numeric IDs configured)
- `createdAt`, `updatedAt`: `{ type: 'string', format: 'date-time', readOnly: true }` — present when `timestamps: true`
- `_status`: `{ type: 'string', enum: ['draft','published'], readOnly: true }` — present when `status: true`

### 7.3 Three derived schemas per collection

Naming convention (signed off 2026-05-12 — public contract):

- `<Slug>` — full response shape, relationships as `oneOf: [string, ref]`
- `Create<Slug>` — input shape for `POST /api/{slug}`; omits `id`/`createdAt`/`updatedAt`/`_status`; includes `password` fields
- `Update<Slug>` — same as `Create` but all fields optional (no `required`)

Singles emit `<Slug>` + `Update<Slug>` (no create/delete). Components emit `<Slug>`.

Repeater item schemas: `<ParentSlug>__<FieldName>Item` (double underscore separator).

### 7.4 Zod cross-validation (dev mode only)

For each collection:

1. Generator builds JSON Schema from `FieldConfig` (the table above).
2. Generator also calls `z.toJSONSchema(collectionZodSchema)`.
3. If they disagree in `dev` mode → warning logged with field path: `[openapi] generator and Zod disagree on field 'Post.title.minLength'`.
4. In `prod`, generator output wins silently; warning still logged for telemetry.

This is a two-witness consistency check. Field configs and Zod schemas are both derived from the same `FieldConfig` interpretation, but through different code paths. Drift is a class of bug worth catching.

**Exception: `json` fields with attached Zod schemas.** Zod is source of truth — `z.toJSONSchema(field.validation.schema)` is called directly.

---

## 8 · Built-in Module Coverage

The ~30 `nextly/api/*` subpaths group into 12 module contributor files under `openapi/modules/`. Pattern:

```ts
// openapi/modules/auth.ts
import { z } from "zod";
import { defineModule } from "../generator/define-module";

export const authModule = defineModule({
  name: "auth",
  tag: { name: "Authentication", description: "Sign-in, sign-up, session." },

  operations: [
    {
      path: "/api/auth/login",
      method: "POST",
      summary: "Sign in with email and password",
      security: [], // login establishes auth; no requirement
      requestBody: {
        required: true,
        schema: z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }),
        examples: {
          default: { email: "alice@example.com", password: "correct-horse" },
        },
      },
      responses: {
        200: { $ref: "#/components/schemas/LoginResponse" },
        401: { $ref: "#/components/responses/Unauthorized" },
        429: { $ref: "#/components/responses/RateLimited" },
      },
    },
    // logout, refresh, register, forgot-password, reset-password ...
  ],

  schemas: {
    LoginResponse: {
      type: "object",
      required: ["user", "accessToken"],
      properties: {
        user: { $ref: "#/components/schemas/User" },
        accessToken: { type: "string" },
        refreshToken: {
          type: "string",
          description: "Only when using cookie strategy.",
        },
      },
    },
    // RegisterRequest, ResetPasswordRequest ...
  },
});
```

### 8.1 Module inventory

| Module file             | Covers `api/*` subpaths                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`               | `auth-state`, `auth/login`, `auth/logout`, `auth/refresh`, `auth/register`, `auth/forgot-password`, `auth/reset-password` |
| `users.ts`              | built-in User collection CRUD                                                                                             |
| `media.ts`              | `media`, `media-bulk`, `media-folders`, `media-handlers`, `uploads`, `storage-upload-url`                                 |
| `email-providers.ts`    | `email-providers`, `email-providers-detail`, `email-providers-test`, `email-providers-default`                            |
| `email-templates.ts`    | `email-templates`, `email-templates-detail`, `email-templates-preview`, `email-templates-layout`                          |
| `email-send.ts`         | `email-send`, `email-send-template`                                                                                       |
| `components.ts`         | `components`, `components-detail`                                                                                         |
| `singles.ts`            | `singles`, `singles-detail`, `singles-schema-detail`                                                                      |
| `collections-schema.ts` | `collections-schema`, `collections-schema-detail`, `collections-schema-export`                                            |
| `rbac.ts`               | roles, permissions, api-keys (if exposed)                                                                                 |
| `health.ts`             | `health`                                                                                                                  |
| `system.ts`             | catch-all (migration status, version, etc.)                                                                               |

Built-in modules ship as part of `nextly/openapi` itself — not separate packages, not user-overridable. Their security declarations are locked (see §10.4).

### 8.2 Reusable components — envelopes & errors

One-time creation in `openapi/mapping/envelopes.ts` and `openapi/mapping/errors.ts`; referenced via `$ref` everywhere they apply.

```yaml
components:
  schemas:
    PaginationMeta:
      type: object
      required: [total, page, limit, totalPages, hasNext, hasPrev]
      properties:
        total: { type: integer, minimum: 0 }
        page: { type: integer, minimum: 1 }
        limit: { type: integer, minimum: 1, maximum: 50000 }
        totalPages: { type: integer, minimum: 0 }
        hasNext: { type: boolean }
        hasPrev: { type: boolean }

    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message]
          properties:
            code:
              type: string
              enum:
                - VALIDATION_ERROR
                - NOT_FOUND
                - FORBIDDEN
                - UNAUTHORIZED
                - DUPLICATE
                - CONFLICT
                - RATE_LIMITED
                - SERVICE_UNAVAILABLE
                - INTERNAL_ERROR
            message: { type: string }
            messageKey: { type: string }
            requestId: { type: string }
            data: { type: object, additionalProperties: true }

  responses:
    Unauthorized:
      {
        description: "Auth required",
        content:
          {
            "application/json":
              { schema: { $ref: "#/components/schemas/Error" } },
          },
      }
    Forbidden:
      {
        description: "Insufficient role",
        content:
          {
            "application/json":
              { schema: { $ref: "#/components/schemas/Error" } },
          },
      }
    NotFound:
      {
        description: "Resource not found",
        content:
          {
            "application/json":
              { schema: { $ref: "#/components/schemas/Error" } },
          },
      }
    ValidationError:
      {
        description: "Invalid input",
        content:
          {
            "application/json":
              { schema: { $ref: "#/components/schemas/Error" } },
          },
      }
    RateLimited:
      {
        description: "Too many requests",
        content:
          {
            "application/json":
              { schema: { $ref: "#/components/schemas/Error" } },
          },
      }
    Conflict:
      {
        description: "Conflict",
        content:
          {
            "application/json":
              { schema: { $ref: "#/components/schemas/Error" } },
          },
      }
```

Generic envelopes per collection — emitted as **name-mangled** concrete schemas (OAS 3.1 `allOf`-generic composition is supported by the dialect but renders poorly in most downstream tooling, including Scalar's "Try it" panel; name-mangling is the v1 default):

- `ListResponse<T>` → `ListResponsePost`, `ListResponseUser`, etc.
- `MutationResponse<T>` → `MutationResponsePost`, etc.
- `BulkResponse<T>` → `BulkResponsePost`, etc.
- `CountResponse` → single shared schema, never parameterized

---

## 9 · Security Schemes & Access Annotations

### 9.1 The three security schemes

Declared once in `components.securitySchemes` by `openapi/mapping/security.ts`:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: |
        JWT issued by `POST /api/auth/login`. Send as
        `Authorization: Bearer <token>`. Tokens expire after 15 minutes.

    cookieAuth:
      type: apiKey
      in: cookie
      name: nextly_access_token
      description: |
        Session cookie set by `POST /api/auth/login` when called from
        a browser. Paired with `nextly_refresh_token` for rotation.
        Cross-site requests need `credentials: 'include'`.

    apiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: |
        Long-lived service credential. Managed at `/admin/api-keys`.
        Bypasses RBAC where granted; scope per key.
```

Adding a fourth scheme (OAuth, SSO) later: one new entry in `security.ts` + one tag per applicable operation.

### 9.2 Per-operation security derivation

| Endpoint kind       | Source of security list                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Auto-generated CRUD | Collection's `access` rule. `read: true` and no `req.user` references → `security: []`. Anything else → all three schemes. |
| Custom endpoint     | `openapi.security: ['bearerAuth', ...]` if set; else inherits from parent collection's pattern.                            |
| Built-in modules    | Hard-coded in each module file. **Locked** — `transform()` may add but not remove.                                         |

### 9.3 `x-nextly-access` annotations

Attached to every operation and to fields with `access` rules:

```yaml
x-nextly-access:
  requires:    'public' | 'auth'
  roles?:      [editor, admin]
  permissions?: ['posts.create', 'posts.update']
  fnDriven:    boolean
  source:      'collection' | 'field' | 'plugin' | 'module'
```

**Extraction rules:**

| Access rule shape                                                  | Annotation                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `access: { read: true }`                                           | `requires: 'public', fnDriven: false`                          |
| `access: { read: false }`                                          | `requires: 'auth', roles: []` (rare; usually misconfiguration) |
| `access: { read: { roles: ['admin'] } }` (future declarative form) | `requires: 'auth', roles: ['admin'], fnDriven: false`          |
| `access: { read: (...) => ... }`                                   | `requires: 'auth', fnDriven: true`                             |
| No `access` key                                                    | `requires: 'auth'` (Nextly default)                            |

Annotations are advisory; the server is source of truth.

### 9.4 Built-in module security lock

`generator/validate.ts` post-processes the spec:

- For any operation whose `path` starts with a known built-in module prefix (`/api/auth`, `/api/media`, `/api/email-*`, etc.), verify that the `security` array contains the framework's declared minimum.
- If a `transform()` hook removed entries, restore them and log: `[openapi] plugin '<name>' attempted to weaken built-in security on '<path>' — change ignored`.
- Additions are allowed (plugins can require additional schemes for built-in endpoints).

This is the single biggest correctness-vs-flexibility tradeoff in the design. Documented escape hatch: if a user genuinely wants different security on a built-in endpoint, they unmount the built-in handler and define their own at the same path.

---

## 10 · Versioning Strategy

### 10.1 Scope of this spec (in vs out)

Versioning work is split. Read this first; the rest of §10 only describes the **in-scope** portion.

**In scope (build now):**

| Capability                       | Mechanism                                                                  |
| -------------------------------- | -------------------------------------------------------------------------- |
| Declare the API version          | `info.version: '1.0.0'` in `defineOpenApi`                                 |
| Mark an operation as deprecated  | `operation.deprecated: true`                                               |
| Mark a field as deprecated       | `field.openapi.deprecated: true`                                           |
| Document deprecation timelines   | `x-nextly-since`, `x-nextly-removed-in`, `x-nextly-replacement` extensions |
| Bump version on breaking changes | User-driven; `info.version` follows semver                                 |

This is sufficient for everything Stripe, Twilio, Linear, and most production APIs actually do for versioning.

**Out of scope (deferred to a future spec):**

| Capability                                                                  | Why deferred                                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/`, `/api/v2/` URL prefixes                                         | Would break every existing client; large doc/template rewrite; no concurrent versions to serve yet. Confirmed deferred 2026-05-12. |
| Separate `admin/api/openapi/v1.json` / `v2.json` endpoint serving           | Only meaningful once two versions coexist                                                                                          |
| Header-based content negotiation (`Accept: application/vnd.nextly.v1+json`) | Rejected approach (poor DX, not Scalar-friendly)                                                                                   |
| Per-operation routing-layer version tagging                                 | Activated when path-versioning lands                                                                                               |
| Backward-compat shims / migration tooling between versions                  | Trigger when first breaking change ships                                                                                           |

A small piece of **dormant** IR scaffolding (a `versions: string[]` field on internal operation records, defaulting to `['1.0']`) is kept in v1 — see §10.3. It carries no v1 behavior and is not user-facing. Its only purpose is to avoid an IR refactor when path-versioning eventually lands.

### 10.2 v1 strategy (this spec)

1. **`info.version`** — set by user via `defineOpenApi({ info: { version: '1.0.0' } })`. Defaults to `package.json` version.

2. **Per-operation `deprecated: true`** + optional `x-nextly-since` / `x-nextly-removed-in` / `x-nextly-replacement`:

   ```yaml
   /api/posts/legacy-import:
     post:
       deprecated: true
       x-nextly-since: "0.5.0"
       x-nextly-removed-in: "2.0.0"
       x-nextly-replacement: "POST /api/posts/import"
   ```

3. **Same trio valid on fields and parameters.** Scalar renders the `deprecated` badge automatically.

### 10.3 Multi-version generator scaffolding (dormant in v1)

Internal preparation for future `/api/v2/...` paths. **Not a user-facing v1 feature** — this is a small zero-cost lookahead on the internal IR shape so that a future spec adding path-versioning doesn't require an IR refactor. The IR carries `versions: string[]` on every operation; in v1, everything is `['1.0']` and version routing is dormant:

```ts
// Internal IR shape
interface OperationIR {
  path: string;
  method: HttpMethod;
  versions: string[]; // ['1.0'] in v1; ['1.0', '2.0'] when path-versioning lands
  // ...
}
```

Future endpoints (when path-versioning is introduced):

- `admin/api/openapi/v1.json` — operations where `versions.includes('1.x')`
- `admin/api/openapi/v2.json` — operations where `versions.includes('2.x')`
- `admin/api/openapi/openapi.json` — alias for latest stable

The scaffolding exists so v2 doesn't require a generator rewrite — just a config flip and per-operation tagging.

---

## 11 · Renderer Interface & Scalar Integration

### 11.1 The interface

```ts
// nextly/openapi — public type
export interface DocsUiRenderer {
  name: string; // 'scalar' | 'swagger-ui' | 'redoc' | custom
  /** Returns the HTML response body. Must NOT inline the spec JSON. */
  render(args: {
    specUrl: string; // same-origin URL where the spec is served
    title: string;
    theme?: "light" | "dark" | "auto";
    cspNonce?: string; // when admin uses strict CSP
  }): { html: string; assetsBasePath?: string };
  /** Files (JS, CSS, fonts) served at assetsBasePath. */
  assets(): Map<string, { content: Buffer; mime: string }>;
}
```

### 11.2 Bundled renderers

Three implementations ship; one is default:

```ts
const renderers: Record<string, DocsUiRenderer> = {
  scalar: scalarRenderer(),
  "swagger-ui": swaggerUiRenderer(),
  redoc: redocRenderer(),
};
```

All three of `@scalar/api-reference`, `swagger-ui-dist`, `redoc` are **optional peer dependencies**. Pattern:

```json
{
  "peerDependencies": {
    "@scalar/api-reference": "^1.55.0",
    "swagger-ui-dist": "^5.x",
    "redoc": "^2.x"
  },
  "peerDependenciesMeta": {
    "@scalar/api-reference": { "optional": true },
    "swagger-ui-dist": { "optional": true },
    "redoc": { "optional": true }
  }
}
```

The relevant renderer is dynamically imported only when its `ui:` value is selected AND the package is installed. A user who never touches the docs UI pays zero install/bundle cost.

### 11.3 Graceful fallback when no renderer installed

If the user mounts the handler but hasn't installed any renderer package, the route serves a built-in HTML page (~1 KB inline in core, no extra dep) explaining how to install one:

```
┌─────────────────────────────────────────────┐
│ ⚠ The Scalar docs renderer is not installed.│
│                                              │
│ To enable interactive API docs, install it: │
│                                              │
│   pnpm add @scalar/api-reference            │
│                                              │
│ Or use a different renderer in your config: │
│   defineOpenApi({ ui: 'swagger-ui' })       │
│                                              │
│ The raw spec is available at:               │
│   admin/api/openapi/openapi.json            │
│   admin/api/openapi/openapi.yaml            │
└─────────────────────────────────────────────┘
```

Build-time SDK generators still work without a renderer installed — they only need the JSON spec endpoint.

### 11.4 Scalar HTML scaffold (default)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <link rel="stylesheet" href="{assetsBasePath}/scalar.css" />
  </head>
  <body>
    <script id="api-reference" data-url="{specUrl}"></script>
    <script src="{assetsBasePath}/scalar.js"></script>
  </body>
</html>
```

`{assetsBasePath}` defaults to `admin/api/openapi/_assets`, served by the same route handler reading from `scalar.assets()`. Files come from `node_modules/@scalar/api-reference/dist/` at build time. No external CDN.

### 11.5 CSP safety

The handler issues a strict per-response CSP allowing only `'self'` and the specific nonces it emits. No `'unsafe-inline'`, no `'unsafe-eval'`. If the user has a stricter app-wide CSP, the renderer accepts a `cspNonce` parameter to operate within it.

### 11.6 ETag + Cache-Control on `/openapi.json`

```ts
const etag = `W/"${schemaHash}-${configHash}-${pluginsHash}"`;
headers.set("ETag", etag);
headers.set(
  "Cache-Control",
  `public, max-age=${maxAgeSeconds}, must-revalidate`
);
headers.set("Vary", "Accept"); // openapi.json vs openapi.yaml
```

Clients with cached copies send `If-None-Match: <etag>`; the handler returns `304 Not Modified` with no body. Significant bandwidth and latency win for Scalar's auto-refresh and for build-time SDK regenerators.

### 11.7 YAML format

Generated via `yaml@2.x` (already in pnpm overrides). Same in-memory IR, different serializer. Convenience for tools that prefer YAML (`openapi-cli`, `redocly lint`, some Python ecosystems).

### 11.8 OAS 3.0 fallback dialect

Single config flag: `openapi: { dialect: '3.1' | '3.0' }`. 3.1 stays default. Useful for legacy code generators that haven't caught up with 3.1's `oneOf`/discriminator semantics.

---

## 12 · Performance Budget & Caching

### 12.1 Latency targets

| Operation                | Frequency                         | Target                      | Mechanism                                    |
| ------------------------ | --------------------------------- | --------------------------- | -------------------------------------------- |
| **Cold spec generation** | Once per process per `schemaHash` | < 80 ms (50-collection app) | Synchronous JS, no I/O after registries warm |
| **Cache hit**            | Every other request               | < 2 ms                      | `LRUCache<cacheKey, Buffer>` lookup + ETag   |
| **304 Not Modified**     | Repeat fetches                    | < 1 ms                      | ETag compare, empty body                     |

### 12.2 Cold-gen latency derivation

- Field mapping: 17 mapper types × ~10 fields × 50 collections × 5 µs ≈ 42 ms
- Envelope/error component assembly: ~10 ms
- Serialization (~500 KB JSON output): ~15 ms
- Validation: ~10 ms
- Subtotal: ~77 ms + headroom for outliers

### 12.3 Cache key composition

```ts
cacheKey = sha1(
  schemaHash + // registry change events bump this
    configHash + // defineOpenApi() inputs (stringified, stable)
    pluginsHash + // sorted plugin names + versions
    serializerFormat // 'json' | 'yaml'
);
```

### 12.4 Cache shape

`LRUCache<cacheKey, Buffer>` with `max: 4` entries (json+yaml × current+previous schemaHash). Bounded; cannot grow.

### 12.5 Serverless cold start (Vercel)

- JSON spec route (`openapi.json`): < 50 ms cold start; no UI dependencies.
- Docs UI route (`admin/api/openapi`): +30 ms cold start for `@scalar/api-reference` import.
- Memory ceiling: ~6 MB worst case (4 entries × ~1.5 MB max per buffer).

---

## 13 · Migration & Rollout

Three phases, gated by user feedback. Each phase is a single changeset on the `alpha` release channel.

### 13.1 Phase 1 — alpha (2 weeks)

- Generator for code-first + visual-builder collections, singles, components
- Eight response envelopes as reusable components
- All built-in module contributors (auth, users, media, email, components, singles, collections-schema, rbac, health, system)
- Scalar renderer as optional peer dep + graceful fallback
- `defineOpenApi()` minimal API: `info`, `servers`, `access`, `ui`, `cache`
- Ship to `alpha` channel; collect playground feedback

### 13.2 Phase 2 — alpha+1 (2–3 weeks)

- `openapi:` slot on Collection / Single / Field / CustomEndpoint
- Plugin contract extension (`contribute` + `transform`)
- `x-nextly-access` annotation generator
- Multi-version generator scaffolding (dormant)
- Admin UI panel for editing overrides on visual-builder collections (small form per slot type)
- `exclude` / `include` config knobs

### 13.3 Phase 3 — beta (1 week)

- Documentation site under `docs/api-reference/openapi.mdx`
- Examples in `apps/playground`
- Migration guide for users upgrading from no-docs
- OAS 3.0 fallback dialect
- Final security review (info disclosure, CSP, rate limit)
- Promote to `beta` channel

### 13.4 Stability commitment

Mark stable at `1.0.0` alongside the rest of Nextly. Until then, every minor alpha release can break the override slot shape if needed (alpha consumers expect this).

### 13.5 No-op for existing users

Existing Nextly users who don't add the openapi route handler experience zero change — no new dependencies are installed (optional peer deps), no runtime cost, no behavior shift.

---

## 14 · Security Considerations

### 14.1 Information disclosure (public docs default)

User-chosen public-by-default exposes:

- Collection slugs, field names, validation rules, enum values
- Authentication schemes accepted
- Existence of admin-only operations (their `x-nextly-access`)

**Mitigations:**

| Mitigation                                   | API                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Per-collection exclusion                     | `defineOpenApi({ exclude: { collections: [...] } })`                            |
| Per-field exclusion                          | `field.openapi.hidden: true`                                                    |
| Hidden admin collections excluded by default | `collection.admin.hidden: true`                                                 |
| Per-path exclusion                           | `defineOpenApi({ exclude: { paths: ['/api/_internal/*'] } })`                   |
| Sensitive-name warning at startup            | Fields matching `/password\|secret\|token\|apiKey/i` not auto-hidden but warned |

Migration guide explicitly flags this tradeoff.

### 14.2 CSP / XSS hardening

- Spec served as `application/json`, never rendered as HTML
- Scalar sanitizes user-controlled content; CSP excludes `'unsafe-inline'`
- Markdown in descriptions parsed with HTML disabled
- Per-response strict CSP with nonces; `cspNonce` parameter accepted for stricter app-wide policies

### 14.3 Rate limiting

Default rate limits on the docs routes (configurable):

- `openapi.json` / `openapi.yaml`: 60 req/min/IP
- Docs UI: 120 req/min/IP

Disabled via `openapi: { rateLimit: null }`.

### 14.4 Transform hook trust model

Plugin `transform()` runs in the same process; no isolated VM. Documented: plugins must be trusted code. Same trust model as Nextly's existing plugin system; no new attack surface beyond what `init()` already exposes.

### 14.5 Built-in security lock

See §9.4. Plugins cannot weaken framework auth declarations; attempts logged and reverted.

---

## 15 · Testing Strategy

All tests use Vitest (existing convention). Five categories:

### 15.1 Unit tests per field mapper

`openapi/mapping/fields/*.test.ts` — one per field type. Pure functions; 100% line coverage target.

### 15.2 Pipeline integration tests

`openapi/generator/__tests__/pipeline.test.ts` — build fixture config, assert full generated document.

### 15.3 Snapshot test

One large snapshot covering built-in modules + fixture collections. Catches accidental breaking changes; Vitest `--update` required to refresh.

### 15.4 OAS 3.1 validity contract test

Validates every generated spec against the OAS 3.1 JSON Schema (`@apidevtools/openapi-schemas`). Runs on every PR.

### 15.5 Plugin extensibility tests

Fixture plugins exercising both `contribute()` and `transform()`. Asserts merge order: app > plugins, later plugin > earlier plugin.

### 15.6 End-to-end test

`packages/nextly/src/openapi/__tests__/e2e.test.ts` — spins up real Nextly instance, hits `admin/api/openapi/openapi.json` over HTTP, validates response + ETag behavior + 304s.

### 15.7 Coverage target

90%+ overall on `openapi/**`. Pure mappers hit 100%; integration code is heavier on branches.

---

## 16 · Long-Term Maintainability

### 16.1 File size discipline

| Component                   | Target      |
| --------------------------- | ----------- |
| `openapi/*` files (general) | < 300 lines |
| `openapi/modules/*`         | < 200 lines |
| `openapi/mapping/fields/*`  | < 150 lines |

Enforced socially (PR review) and via lint rule.

### 16.2 Adding a new field type (process)

1. Add TypeScript config to `collections/fields/types/`
2. Add `openapi/mapping/fields/<new-type>.ts` (~50 lines)
3. Add `openapi/mapping/fields/<new-type>.test.ts`
4. Register in `openapi/mapping/fields/index.ts` (one line)
5. Snapshot test auto-updates on review

Documented in `CONTRIBUTING.md`. Estimated cost per field type: ~2 hours.

### 16.3 Adding a new OAS dialect

Serializer isolated in `openapi/generator/serialize.ts`. New dialect = new serializer + conditional in route handler. IR unchanged.

### 16.4 Plugin contract evolution

`PluginDefinition.openapi` versioned implicitly via TypeScript types. Adding optional fields is non-breaking. Removing fields requires major version bump.

### 16.5 Regression coverage

Snapshot + OAS-validity tests run on every PR. Pre-commit hook in `.husky/` can run them locally (existing pattern).

---

## 17 · Risks & Mitigations

| Risk                                         | Likelihood            | Severity | Mitigation                                                                   |
| -------------------------------------------- | --------------------- | -------- | ---------------------------------------------------------------------------- |
| Field config drifts from Zod schema          | Medium                | Low      | Cross-validation in dev mode (§7.4)                                          |
| `transform()` hook breaks the spec           | Medium                | Medium   | Validate-after-transform; prod logs + serves last-known-good cached spec     |
| Cold-start latency on serverless             | Low                   | Low      | < 80 ms target; cache survives within warm instance                          |
| Generator output too large (> 10 MB)         | Low                   | Medium   | Cap at 10 MB; warn at 5 MB                                                   |
| New OAS version (3.2) breaks tooling         | Low                   | Low      | Stay on 3.1 default; 3.0 fallback already designed                           |
| Scalar library changes API                   | Low                   | Low      | Renderer interface seam; swap is one-file change                             |
| Plugin authors weaken security via transform | Medium                | High     | Built-in module security lock (§9.4)                                         |
| Public spec reveals sensitive structure      | High (chosen default) | Medium   | Per-field/path exclusion + sensitive-name warning + migration guide flagging |

Highest-severity risk: plugin authors weakening security via `transform()`. Single biggest design call.

---

## 18 · Open Questions & Future Work

Not blockers for v1; tracked for future iterations.

1. **OAS 3.0 fallback testing matrix** — which downstream tools actually need 3.0 vs 3.1? Worth surveying real adopters before shipping the dialect flag.
2. **Localization in the spec** — `field.localized: true` is reserved in the field config; if/when Nextly ships localization, the spec needs `x-nextly-locales` and possibly per-locale `examples`.
3. **GraphQL parallel** — if Nextly grows a GraphQL surface, share the IR or build separately? Not decided.
4. **OpenAPI Webhooks** — Nextly has hooks; webhooks (outgoing HTTP) could be documented via OAS 3.1 `webhooks` key. Not in v1.
5. **OAuth2 / OIDC out-of-the-box** — `securitySchemes` template ready, but actual OAuth2 flows aren't a framework feature yet.
6. **Admin UI override panel — schema-driven render** — the visual builder panel for `openapi:` overrides should be generated from the override TypeScript types, not hand-built. Tooling work for later.

---

## 19 · Glossary

- **IR (Intermediate Representation)** — internal normalized model the generator uses between collecting registry data and serializing to JSON/YAML.
- **schemaHash** — existing hash on `CollectionRegistryService` records; bumps when schema changes. Re-used as a cache key component.
- **Module contributor** — file under `openapi/modules/` that provides operations and schemas for a built-in `api/*` module.
- **Renderer** — a `DocsUiRenderer` implementation (Scalar, Swagger UI, Redoc, or custom) that turns the spec URL into an HTML docs page.
- **Contribute layer** — additive plugin/app inputs merged into the spec.
- **Transform layer** — final-pass mutation hook running after merge.
- **Override slot** — the `openapi?` field on Collection / Single / Field / CustomEndpoint configs.

---

## 20 · Sign-Off

| Section                                                                                | Status                          | Date       |
| -------------------------------------------------------------------------------------- | ------------------------------- | ---------- |
| §1–5 Architecture, public API, mapping, security/access, performance/testing/migration | **Approved** by project owner   | 2026-05-12 |
| Spec doc written                                                                       | This document                   | 2026-05-12 |
| Spec self-review                                                                       | TBD                             | TBD        |
| User spec review                                                                       | TBD                             | TBD        |
| Implementation plan                                                                    | TBD (via `writing-plans` skill) | TBD        |

---

_End of design spec._
