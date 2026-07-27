---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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

Add webhook signing-secret rotation with a configurable overlap window. An
endpoint's secret can now be rotated from the admin: a fresh secret becomes the
primary and the previous one keeps signing for a chosen window (immediately,
24h, 48h — the default, 7d, or 30d) so a receiver can switch over without
dropping a delivery. Deliveries in the window carry a signature for both
secrets, and the old one can be expired early. The endpoint edit page shows each
active secret's lifecycle.
