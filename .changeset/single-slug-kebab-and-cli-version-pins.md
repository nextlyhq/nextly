---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Singles builder popup now auto-derives the slug as kebab-case to match the web convention used by public routes and the entry-form slug validator. Typing `About Page` as the singular name now fills the slug as `about-page` instead of `about_page`. Collections and components keep their existing snake_case defaults so their backend validators continue to accept the auto-generated value unchanged. The shared `BuilderSettingsModal` forwards the per-kind identifier to `BasicsTab`, where the slug-case helper is selected; a new `toKebabName` helper lives alongside `toSnakeName` in `@admin/lib/builder` for downstream consumers that need URL-friendly identifiers.

`create-nextly-app` now resolves the published `@nextlyhq/ui` and `@nextlyhq/plugin-form-builder` versions from the npm registry alongside the other `@nextlyhq/*` packages it scaffolds. Generated `package.json` files pin both via their published semver range instead of falling back to `"latest"`, so fresh projects install the same versions the CLI was tested against.
