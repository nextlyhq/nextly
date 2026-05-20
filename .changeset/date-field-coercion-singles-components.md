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

Fix `update operation failed on table '<table>': value.toISOString is not a function` when saving a Single document or a component instance that includes a date field. JSON request bodies deliver date values as ISO strings (e.g. `"2026-05-20T12:22:29.417Z"`), but Drizzle binds `timestamp` columns by calling `.toISOString()` on the bound value -- so an unmodified string travelling through the adapter blows up at the driver layer. `CollectionMutationService` already coerced date strings into `Date` objects inline at every write site, but the equivalent step was missing from `SingleMutationService.update` and from `ComponentMutationService.serializeComponentRow` (which feeds every insert / update path in the component service via `buildInsertRow` and direct calls).

A new `coerceDateFieldsToDate(data, fields)` helper in `shared/lib/field-transform.ts` mutates the row in place, converting string values for `field.type === "date"` columns into `Date` objects. Existing `Date`, `null`, and `undefined` values pass through untouched, so the function is idempotent and safe to call on rows that were coerced upstream. The signature accepts a structural `ReadonlyArray<{ name?: string; type?: string }>` so the same helper covers both `FieldConfig[]` (singles, components) and the runtime `FieldDefinition[]` (collections). The helper is wired into `single-mutation-service.update` before snake-casing the row and into `component-mutation-service.serializeComponentRow` before column mapping. The six inline copies of the same coercion block in `collection-mutation-service.ts` were collapsed onto the shared helper as part of the same change so there is one implementation across all three domains. Result: PATCH `/admin/api/singles/<slug>` with a `date` field, inserts / updates on components with date fields, and the existing collection flows that already worked all succeed against Postgres, MySQL, and SQLite. Unit tests cover the helper's coercion, idempotency, null / undefined pass-through, and no-touch behaviour for non-date fields.
