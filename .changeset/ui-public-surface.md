---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
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

Make `@nextlyhq/ui` usable as a published package: components now work in a Next.js app, and plugins stay on one shared copy.

Importing a component from `@nextlyhq/ui` into a server-rendered page failed, because the published bundle lost the `"use client"` marker that tells React these components run in the browser. The marker now ships with the package, and the build fails if it ever goes missing again.

`@nextlyhq/ui` also becomes a peer dependency of `@nextlyhq/admin` rather than a bundled one. This is what the plugin documentation already described: the admin and every plugin share a single copy, so components cannot end up talking to a second, isolated instance of the design system. Projects created by `create-nextly-app` already install it, so no change is needed there; a project that added `@nextlyhq/admin` by hand should add `@nextlyhq/ui` alongside it.

Plugins now depend on a compatible _range_ of `@nextlyhq/ui` instead of one exact version, so a plugin keeps working across releases instead of breaking on every one.

Also: the documented `@nextlyhq/ui/tailwind-preset` entry point now exists (previously the import failed), the package declares which files have side effects so bundlers can drop unused components, and the plugin styling guide no longer names a CSS class and design tokens that do not exist — following it produced styles that silently did nothing.
