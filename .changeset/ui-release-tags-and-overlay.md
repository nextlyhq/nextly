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

`@nextlyhq/ui`'s release tags now reach the published types. Every export in the
barrel carried `@public` or `@experimental`, and none of it survived the build:
the declaration bundler flattens each re-export into one `export { … }` clause
and drops the doc comment attached to the export statement, so an editor
hovering `badgeVariants` was told nothing about its stability. The tags live on
the declarations now, where the bundler keeps them, and 229 of them reach
`dist/index.d.ts` where there were none.

`toast` and `ToasterProps` are re-exported from `sonner`, so their declarations
are not ours to annotate; they stay tagged in the barrel only.

Modal scrims are a theme token. Six components wrote the backdrop inline as
`bg-black/80`, identical in light and dark and at four different strengths, so
it could be neither themed nor white-labelled and was invisible to every token
check the package has. `--nx-overlay` (and `--nx-overlay-soft`, for a scrim over
content rather than the page) is defined for both modes and used everywhere,
with `bg-overlay` / `bg-overlay-soft` utilities. Dialogs, sheets and the command
palette now share one backdrop strength rather than three.
