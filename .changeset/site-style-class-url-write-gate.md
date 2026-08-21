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
the same `isFetchableUrl` the published page and the canvas use. Only errors
refuse a write: a warning is a value the engine accepts and emits.

How strictly an unrecognised property is judged now depends on whether the site
configured a host policy, because the validator does not look INSIDE one.

- **No `remotePatterns`: forgiving, and nothing changes.** A property written by
  a newer engine stays a warning, and an absent policy is treated as unasked
  rather than as an empty allowlist.
- **`remotePatterns` configured: strict.** An unrecognised property is an error
  and the write is refused, because a value the gate cannot judge could carry a
  `url()` it will never see. Such a site can no longer store a property this
  engine does not know, and is told which one.

Validation is also bounded now. One issue budget covers the whole classes
section rather than each property map, and the walk stops once it is spent —
between maps inside a class and between classes. A payload spreading invalid
properties across many maps could otherwise ask for work proportional to the
map count, which the document byte cap alone does not limit.
