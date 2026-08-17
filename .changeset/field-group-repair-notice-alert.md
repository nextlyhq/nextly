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

fix(admin): announce the field-group repair notice and clear its contrast failure

The field-group builder drew its save-blocked notice as a hand-rolled tinted
box: a 40%-alpha destructive border that composites to 1.69:1 over the page
surface, against the 3:1 WCAG 1.4.11 asks of a component boundary. That single
call site was the sole reason `packages/ui`'s contrast suite shipped red, so
every lane touching `ui` inherited a failing test that was not theirs.

It is now the shared `Alert`, whose destructive variant carries full-strength
scale tokens and a solid left accent. The notice also gains `role="alert"`:
`needsRepair` is derived from fetched data, so the refusal appears after the
page settles and was previously announced to nobody.
