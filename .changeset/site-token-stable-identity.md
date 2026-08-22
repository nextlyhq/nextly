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

Give a site token a stable identity, so renaming one moves neither the custom property a compiled page references nor the `$token` a stored document holds.

`SiteToken` gains an optional `id`. A token identity is its `id` when it has one and its `name` otherwise, and both the emitted custom property and the config/stored tier merge key on that identity rather than on the name. Every token stored before the field existed carries no id, so its identity is its name and it emits exactly the property it emitted before — nothing migrates. Renaming pins the identity at the name the token already had and moves only the label, which is what keeps existing references resolving.

Because an id and a name share one custom-property space, renaming frees the label but not the property behind it: a new token claiming the freed name is refused and named rather than allowed to shadow the token that left it.

DTCG import and export carry the identity under the `com.nextlyhq.nextly` extension key, which is the only place the format allows it — DTCG has no token id of its own and reserves the `$` prefix. A file from another tool carries no such key and imports with its names for identities rather than having one invented for it.
