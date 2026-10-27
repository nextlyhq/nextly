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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
"create-nextly-app": patch
"nextly": patch
---

A built-in Public role is added: the role visitors will be judged by. It does not change access yet. It can't be deleted, renamed, given to a person or an API key, or joined to another role's inheritance; only its permissions can be set.

A site whose own role already used the slug `public` keeps that role under the next free slug (`public-1`, `public-2`, …) on the first boot of this version, with its name, holders, permissions and inheritance unchanged, and the change is logged. Code access rules that check the role slug `public` must check the new slug instead.

Saving a role in the admin keeps its slug.

An app or plugin role declared with the slug `public` is refused at boot, as one declared with `super-admin` already is.

At boot, the Public role is given `read-media` and the read of each collection and Single whose `read` rule answers `true` for a visitor. Each read is granted once, so one an owner removes stays removed. Access doesn't change yet.

Plugins can declare permissions for the Public role on their own collections with `contributes.publicGrants` (experimental), for example `[{ collection: "tickets", action: "create" }]`. Only `read` and `create` can be granted. Each grant is made once at boot, so one an owner removes stays removed, and a grant on a collection the plugin doesn't contribute is refused and logged. The form builder uses it to let the Public role create form submissions. A plugin's grant lasts only while an enabled plugin declares it: disabling or removing the plugin, or a version that no longer declares it, removes the grant, and the removal is logged. Declaring it again grants it again, except one an owner had already removed.

Each startup log names what the Public role does not hold yet that visitors may rely on: reads with no `read` rule, reads whose rule answers neither `true` nor `false`, writes whose rule answers `true` for anyone, and rules that failed or gave no answer when asked. Grant the Public role each one visitors should keep.
