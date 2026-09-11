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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

An API key created by a Super Admin copies the permission catalogue rather
than the role's rows. A Super Admin's power is a bypass, and the role only
holds the permissions that existed when the install was set up, so a key of
theirs held a stale subset at best and, where the first user came before the
grant, nothing: every request refused, starting with the first key an operator
minted to try an integration with. A `read-only` key of theirs now reads every
collection the install declares, including one added later, and still cannot
write; a `full-access` key holds every permission. A permission a package
stopped declaring is not inherited. Whether the creator is a Super Admin is
asked of the same resolver as the session bypass, so a role built on top of
Super Admin counts here exactly as it does everywhere else.

A plugin calling `ctx.services` as a user now sees that user's roles. The
caller was built with an empty role, so a code-defined rule such as
`req.user?.role === "editor"` refused every caller on the plugin path while
the same caller's own request passed it, and a negative rule granted what it
was written to refuse. The roles are resolved and the caller is built by the
one constructor every other authenticated path uses.

Losing the Super Admin role now takes effect at once. The cached answer to
"is this user a super admin" was not cleared when roles changed, so a demoted
user kept the session bypass until the entry aged out, and an API key's grants
resolved through that answer could be cached for five minutes of their own on
top of it. Role and permission invalidation clears it.

A caller that arrived on an API key is judged on the KEY's roles, not its
owner's, the way the REST path already judges one. A stored role rule reads
the caller's roles directly, so the owner's roles let a viewer-scoped key
minted by an administrator satisfy an administrators-only rule, and refused a
key holding the very role a rule names because its owner did not hold it.
