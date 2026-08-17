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

feat(blocks-react): a route emits the site stylesheet by default

`createBlocksPage` gains `siteStyles` and supplies a sheet by DEFAULT, unlike the
bare `PageRenderer`. Without one, every `{ $token }` resolves to nothing — and a
framework route is exactly where "it should already work" is the right answer.
`PageRenderer` stays opt-in because a standalone consumer owns its own `<head>`
and may already emit a token sheet; a Nextly route owns neither.

Default-on was licensed by measurement rather than assumed safe: no block
declares a token (enforced by a ratchet over every `baseStyles`) and no seeded or
fixture document references one, so nothing's appearance can change by the
definitions arriving.

`breakpoints` falls back to `styleContext`'s, derived once — two answers to "what
are this site's breakpoints" is how the shared sheet and the page sheet come to
disagree about which at-rules a tier compiles under, invisibly, because each
sheet is internally consistent on its own.

The root entry now re-exports `SiteSheetInput` and its transitive closure
(`SiteTokenSet`, `SiteToken`, `TokenKind`, `FontFaceDef`, `FontSource`,
`DarkModeStrategy`), so a consumer can construct a site's design system rather
than merely name the prop.
