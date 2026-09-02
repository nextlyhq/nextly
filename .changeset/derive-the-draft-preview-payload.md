---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The admin derives its email draft-preview payload from the schema the server
validates against, instead of restating it.

The client type was a hand-written mirror of the endpoint's zod schema, so the
wire contract had two definitions. Adding a required field on the server left
the admin compiling cleanly while every preview request was rejected at
runtime — a failure that only shows up in a browser, on a surface whose whole
point is telling an author the truth about what they are sending.

`nextly/api/email-template-preview-types` now exposes the contract as a
types-only entry point, so a consumer building the request derives its payload
and its result from the canonical schema and the renderer's own output type. It
pulls zod and nothing else — no DI container, no route handler — so a type-only
import costs a browser bundle nothing.

The published request type is the schema's INPUT rather than its output. The
three fields that default to null are optional on the wire and required after
parsing, so exporting the parsed shape as the request contract would reject
payloads the endpoint accepts. Both are exposed: `DraftPreviewRequest` for a
caller building a body, `DraftPreviewParsed` for a handler reading one.
