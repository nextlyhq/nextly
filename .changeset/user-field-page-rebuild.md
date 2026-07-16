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
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

User custom fields gained real validation, two new types, multi-value selects, and a rebuilt creation page.

**A field's validation bounds finally do something.** `minLength`/`maxLength` (text-like fields) and `min`/`max` (number) used to be documented on the public field types and read by the checker — but no storage existed for them, so a code-declared `maxLength: 200` silently did nothing. They are now persisted (new nullable columns on `user_field_definitions`, all three databases), synced from `defineConfig()`, editable in the admin's new Validation section, and enforced: an out-of-range value is rejected with a per-field message naming the limit. A `maxLength` also sizes newly created text columns as `varchar(n)`. Existing rows are untouched; constraints apply to new writes on fields that declare them.

**New field types: URL and Phone.** Both validated text, both available to `defineConfig()` and the admin alike. They are user-profile types only — collections cannot declare them, so they never touch the schema pipeline.

**Selects can store multiple values.** The backend always supported `hasMany`; the admin now offers "Allow multiple selections" when creating a select field. Like name and type, it is fixed at creation because it decides the backing column's type.

**The Create/Edit User Field page was rebuilt** on the shared field-UI kit: a single-column form whose reading order matches its causal order — the type picker (all 10 types, rendered from the shared catalog) sits at the top and everything it governs follows. The 400px side rail, the duplicated header, and the stale "Field Rules & Default" heading are gone; the selected type card's highlight is token-driven (the inline style that defeated it is deleted); duplicate option values are reported all at once.
