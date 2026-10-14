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

A plugin-defined signed-in person can now read and write collections, under
access rules and nothing else. Collection and field rules receive the person as
`principal`, beside a `user` that is `null`, and collection hooks receive them
too. A person is admitted only by a code-defined rule that names them, or one
set to `true`: a collection with no rule for the operation refuses them,
database permissions and the super-admin bypass never apply, and a person can
never publish. Every other caller's rule receives `principal: null`.

Collection and Single operations on the Direct API, and a plugin's
`ctx.services` collection calls, take a `principal` option to run as a person.
The call is refused before it runs if it also asks to skip access rules or
the filterable-field check (`frameworkFilter`), names a staff user or an API
key, or names a person core did not make; any other operation refuses the
option, and it cannot be a Direct API instance default. `findSingles` made
as a person lists, and counts, only the Singles the person may read. A document created as a person has no owner.
`nextly.principals.byId` and `ctx.principals.byId` find a person through the
kind's `lookup`, checked as a resolver's answer is.

An update or delete by `where` made under access rules (a person's, or any
call with `overrideAccess: false`) now refuses a `where` on a field the
caller may not read before it writes anything, as a read already did; the
rows it touched used to answer whether a guessed value matched.

A dev reload now installs the kinds of signed-in person it reads only once it
commits, and a kind's attributes may no longer be optional.

`AccessControlContext` and a field rule's arguments gain a required
`principal`, so code that builds either by hand adds `principal: null`.
