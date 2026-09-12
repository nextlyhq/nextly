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

Changing a permission row now retires the cached answers derived from it, and
retiring them is no longer a separate step a writer has to remember: every
write goes through one place that does both. None of the methods writing those
rows invalidated anything, and neither of the existing invalidations can
express the change, because a permission row belongs to no user and no role. So
a role-based key kept a renamed slug, and a Super Admin's key kept a deleted
grant and missed a new one, until their entries aged out.

A cached answer resolved before an invalidation is no longer written after it.
Every cache here is filled from an asynchronous read, so a lookup that began
before a role changed could complete afterwards and put the old answer back into
a cache that had just been cleared.

A call whose caller's roles could not be read is refused rather than run as a
caller with none, with a typed error rather than the driver's own. The resolver
behind it degraded a failed query to an empty set, which is safe for a rule that
grants on a role and wrong for one that withholds on it: `user.role !==
"suspended"` admitted a caller the database declined to answer for.

This covers an API KEY's roles as well as a plugin call's. A read-only or
full-access key resolves its owner's roles, and those populate the scope every
later role rule reads directly, so a failed lookup arriving as an empty set was
indistinguishable there from an owner who holds no roles. Both paths now ask one
resolver that refuses, rather than each deciding for itself what an unanswerable
question means.

Losing the Super Admin role now takes effect at once. The cached answer to
"is this user a super admin" was not cleared when roles changed, so a demoted
user kept the session bypass until the entry aged out, and an API key's grants
resolved through that answer could be cached for five minutes of their own on
top of it. Role and permission invalidation clears it, and an API key's cached
grants are retired with it: they are derived from the same rows, and nothing
retired them when a ROLE changed, so revoking a role's inherited Super Admin
left a key holding the whole catalogue and changing a role's permissions left a
role-based key holding the old set.

A caller that arrived on an API key is judged on the KEY's roles, not its
owner's, the way the REST path already judges one. A stored role rule reads
the caller's roles directly, so the owner's roles let a viewer-scoped key
minted by an administrator satisfy an administrators-only rule, and refused a
key holding the very role a rule names because its owner did not hold it.

Stored permission answers now expire after five minutes rather than a day.
`PERMISSION_CACHE_TTL_SECONDS` still sets it. The stored tier is shared between
instances and the signal that retires it is held in memory, so an instance that
did not handle a role change goes on serving what it stored until the entry
expires; the default was a day, which is not a bound worth having on a revoked
grant. Installs running a single instance see slightly more cache misses and no
change in behaviour.

A batch of permission writes no longer defers an unrelated revocation. Seeding
retires the caches once at the end rather than per row, and the batch is now
scoped to the operation that opened it, so a revocation raised while a seeder
happens to be running takes effect immediately instead of waiting for the
seeder to finish.

A permission answer computed while the caches are being cleared is no longer
stored. Clearing the shared tier is itself a write, and a check that both began
and finished during it could read a row the clearing had not yet reached and
promote it, which put a retired answer back into a faster tier that outlives
the clearing.
