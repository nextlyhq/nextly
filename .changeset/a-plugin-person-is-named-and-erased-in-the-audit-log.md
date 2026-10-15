---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A plugin can now name a person it signs in on an audit row, and erase them when
it deletes them. `ctx.audit.write` takes `actorPrincipal` and `targetPrincipal`,
by kind and id, kept in new columns of their own. Such a row keeps its network
address, browser and metadata. A person's id in `actorUserId` or `targetUserId`
is still stored as an erased account's, as before.

`ctx.principals.reportDeleted(person, { tx })` erases a person from the audit
trail in one transaction, the plugin's own when it passes `tx`. Core clears the
address and browser on every row the person acted on, and the plugin metadata
on every plugin row naming them. It names the person on those rows by a keyed
digest of kind and id, in place of the id, and keeps only that digest and when,
in the new `nextly_deleted_principals` table. Every row written about the
person afterwards is written already erased. A report made inside an open
transaction without passing it is refused.

The digest's key is made once and kept sealed under `NEXTLY_SECRET`. After a
rotation, keep the old secret in `NEXTLY_SECRET_PREVIOUS` until the app has
started once with both, as for plugin settings.

Every audit row now records which kind of caller acted, in `actor_kind`:
`staff`, `apiKey`, `core`, `anonymous`, or the person's kind. Rows written
before this release keep `NULL` there and read as before. `nextly migrate` and
boot add the new columns, indexes and table on all three databases, and
rewrite no row.

`RequestActor` gains the `principal` type for a write made as a person. It
carries the person's kind and id and no `id`, so the activity log, which
records staff only, records no row for it. Webhook deliveries still report such
a write as `system`, as they did before.
