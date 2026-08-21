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

fix(plugin-page-builder): judge a stored class's values under the site's host policy

A named class is emitted verbatim into the sheet of every public page, and the
Site Style write gate never read inside its `styles`. `isUsableNamedClass` types
the envelope and stops there, so a class carrying
`background: { url: "https://tracker.example/p.png" }` was stored, compiled and
served to every visitor of every page — while the identical value written on a
node was refused, because the renderer polices node styles and nothing policed
the site sheet.

The classes field now runs each entry's values through the engine's own
`validateStyleValues` with the site's `remotePatterns` predicate, derived through
the same `isFetchableUrl` the published page and the canvas use. Forgiving mode,
errors only: a property a newer engine wrote stays a warning, and a warning is a
value the engine accepts and emits.

A site that configured no `remotePatterns` is unchanged — the engine treats an
absent policy as unasked, not as an empty allowlist.
