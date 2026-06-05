---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Three related singles / API consistency fixes.

REST responses for collections previously included both snake_case (`created_at`, `updated_at`) and camelCase (`createdAt`, `updatedAt`) variants of the system timestamp fields. The conversion helper added the camelCase aliases but never removed the snake_case originals, so list and detail endpoints surfaced duplicate keys per row. The snake-to-camel conversion now lives in a single helper, `convertTimestampsToCamelCase`, exported from `shared/lib/case-conversion.ts` next to the existing `keysToCamelCase` / `keysToSnakeCase` utilities. Both `collection-query-service` and the singles `deserializeJsonFields` path call it directly. The previous `withTimestampAliases` wrapper and its re-export from `domains/collections/index.ts` are removed. Collections responses now match singles / media / users / api-keys / uploads, which already emitted the camelCase form only.

The admin sidebar's singles list now renders every single in the project rather than capping at the `useSingles()` default page size of 10. `DynamicSingleNav` drives a `useInfiniteQuery` against the singles endpoint and walks subsequent pages while `meta.hasNext` is true. Each request is bounded to 100 rows so per-request DB load stays small. Secondary consumers that derive visibility or grouping data from the singles list (`DualSidebar`, `DynamicCustomGroupNav`, `SinglesLandingRedirect`) now pass an explicit `pageSize: 100` to `useSingles`, matching the pattern already used by the collections sidebar fetch. This stops the same truncation symptom from hiding section headers or misrouting the `/admin/singles` landing redirect when the project has more than 10 singles.

The `GET /admin/api/singles` handler now accepts a 1-based `page` query parameter as an alternative to `offset`. The admin UI's shared `buildQuery` helper emits `page` for every paginated route; previously the singles endpoint read only `offset`, so a page change in the Singles builder table left the offset at 0 and the same first page was returned for every navigation. When both `offset` and `page` are supplied `offset` wins, preserving the existing external API contract.
