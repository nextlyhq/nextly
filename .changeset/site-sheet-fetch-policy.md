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

fix(blocks-engine, blocks-react): give the site sheet the host-fetch policy the page sheet already had

`SiteSheetInput` had no `mayFetchUrl` member, so `compileSiteSheet` compiled the
named-class and block-default tiers with no host question asked — while
`PageRenderer` passed `remotePatterns` into the page compile for node styles.
A stored class naming a host the site refuses was therefore emitted into the
sheet of every page, and the site sheet is emitted first, where a page sheet
that merely omits a declaration cannot retract one.

`SiteSheetInput` now accepts `mayFetchUrl` and threads it into its
`compilePageCss` call. `effectiveCompile` returns the predicate it derives so
`PageRenderer` hands the same function to both sheets: reading it off the
reconciled compile context would have asked nothing on the ordinary production
path, where a consumer rendering a stored artifact supplies no style context and
that context is `undefined`.

No `fetchPolicyId` counterpart on this input. That stamp exists so a reader can
tell whether a stored sheet predates the current rules; this artifact is
compiled per render and addressed by the hash of its own bytes, so a policy that
changes what is emitted changes the name.

A site that configured no `remotePatterns` is unchanged — absent is unasked, not
an empty allowlist.
