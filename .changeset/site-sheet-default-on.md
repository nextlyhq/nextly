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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(blocks-react): emit the design-token sheet by default from PageRenderer too

`PageRenderer` was opt-in while a Nextly route emitted by default, and the
asymmetry cost more than it saved: a block could not reference a token at all,
because a default reading `color.surface` resolved on a route and silently
resolved to nothing in a standalone render. `core/card` shipped with no
background and no border for that reason, and the pressure that produced six
blocks reaching for the admin `--nx-*` namespace stayed exactly where it was.

Both paths now emit, and a host opts out with `siteStyles={false}` — an explicit
refusal rather than an empty token list, because `resolveSiteTokens` LAYERS, so
an empty override means "no overrides" and still yields every default. A test is
what found that the opt-out did not exist at all.

Breakpoints come from the RECONCILED compile context rather than the caller's
`styleContext`, so a consumer rendering a stored artifact — the ordinary
production path — gets a sheet instead of nothing.
