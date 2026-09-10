---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

`getCachedNextly` is exported from `@nextlyhq/plugin-sdk`. Plugin server work
that runs outside a route has no `ctx.services` to reach through and no config
in scope, so it needs the already-booted instance; until now the only import
path was core's root, which is not the surface a plugin's compatibility is
governed on. It is `@experimental` there, per the stability ladder.

`@nextlyhq/plugin-page-builder` reads its site-style single through that import
now instead of core's root.

Its docblock also described the wrong boundary. It said publishing the accessor
from `nextly/runtime` would force a `next` peer dependency on plugin consumers.
It would not: `next` is the one peer this package does not mark optional, so a
consumer resolves it whichever subpath they import. What the root actually
avoids is `next/*` entering a module graph that has no request lifecycle to run
inside, which matters to a plugin bundled for the browser and to the CLI.
