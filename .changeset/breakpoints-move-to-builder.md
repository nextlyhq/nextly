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
---

move the breakpoint editor into the builder, where its rules can be derived

`lib/breakpoints.ts` and `breakpoint-dialog.tsx` restated the style compiler's
breakpoint drop rules because `@nextlyhq/ui` is the block-agnostic layer and
cannot depend on `@nextlyhq/blocks-engine`. Two implementations of one rule
agree the day they are written and drift silently after.

They now live in `@nextlyhq/builder`, which already depends on the engine and
imports `MAX_BREAKPOINTS_PER_AXIS` and the breakpoint types from it rather than
mirroring them.

**Breaking, and deliberate:** the `@nextlyhq/ui/breakpoints` subpath is removed,
along with `BreakpointDialog` and the breakpoint types from the root barrel.
Nothing in this repository imported them, and every affected export was
`@experimental`.
