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

A field group whose stored definition no longer describes its tables can now be repaired from the admin, and the repair is shown before it runs.

A field group is marked `diverged` when its tables changed and the record describing them did not, and it refuses every schema edit until that record is repaired. The repair existed but nothing could reach it. The Schema Builder now explains the block where it happens — on the field group being edited, which is where saving is refused — and the field group list offers the same repair on any row marked `diverged` or `failed`.

The repair is previewed first. Reviewing it lists what would change by name rather than by count: fields whose columns are gone, attributes being brought back in line, and columns nobody declared, which are adopted under a type guessed from the physical column and are the ones worth correcting afterwards. Where the definition cannot be repaired without guessing — a column present on both tables, a physical type that no longer matches — each reason is reported individually and nothing is written. Approving a repair sends the version it was read against, so a plan reviewed in one tab can never be applied to a field group another tab has changed since. Previewing writes nothing and takes no lock, so it is safe to run at any time.

The same operation is available as `GET` and `POST` on `/api/field-groups/schema/[slug]/reconcile` for callers driving it directly, and the result types are exported from `nextly/field-group-reconcile` for anyone rendering them.

Note for anyone managing roles: saving in the Schema Builder requires `update-settings`. A role holding `create-settings` without it can open the builder and cannot save, which surfaces as saving being broken for one person rather than as a permission.
