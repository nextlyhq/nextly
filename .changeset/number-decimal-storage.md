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

Number fields can now store exact decimals for prices and other fractional values.

Code-first number fields stored whole numbers only, so a value like `19.99` was silently truncated to `19` at the database, even though the field documentation showed prices and cent-level steps. Number fields now accept `dbType: "decimal"` (with optional `precision` and `scale`, defaulting to `DECIMAL(10, 2)`), which stores the value in an exact `DECIMAL`/`NUMERIC` column on Postgres, MySQL, and SQLite. Integer remains the default, so existing fields are unchanged.

```ts
number({ name: "price", dbType: "decimal", scale: 2 }); // stores 19.99 exactly
```
