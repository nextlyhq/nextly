---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

A plugin can now hand its own configuration to its own admin components.

A plugin's factory runs on the server, where the host builds its config; its
admin components run in the browser. Nothing carried a value between the two, so
a plugin could ship behaviour it had no way to configure. `contributes.admin.clientConfig`
travels with the rest of the admin metadata, and `usePluginClientConfig` reads it
back. It is world-readable, and the serializer refuses anything that will not
survive the trip rather than delivering a mangled copy.

The page builder uses it for `remotePatterns`. The editor canvas previously
enforced an empty allowlist while the published page enforced the host's, so it
hid images the live page shows. Declare them once with
`pageBuilder({ remotePatterns })` and the canvas and the page agree.
