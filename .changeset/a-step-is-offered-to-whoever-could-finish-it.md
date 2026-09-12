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

The dashboard's onboarding checklist now offers "create your first collection" to
every reader who could finish it, and to no reader who could not.

An administrator who is not a super admin was never shown the step. Creating a
collection seeds its permissions to the super-admin role, but the built-in role
presets are re-resolved against the live permission list on every boot, and the
`admin` preset covers a content collection — so an admin does reach what they
created, from the next start. The checklist asked only about the immediate seed
and hid a step that was theirs to take.

An API key was offered it on any grant beginning `read-`. The read decision
admits a key on an exact `read-<slug>` match, so a key stamped `read-settings`
could only finish the step by creating a collection called `settings` — a
reserved name. It is now offered the step only where its grant names a
collection that could actually be created.

Both answers are computed from the declarations that produce them — the seeder's
role and the preset predicates, and the collection slug rules themselves — rather
than restated beside them, so a preset or a reserved name that changes carries
the checklist with it.

A widget source contributed by a plugin is now keyed from the record the registry
published rather than by reading the plugin's object a second time. A JavaScript
`id` may be an accessor or a proxy, and a second read that answered differently
filed the resolver under an id no source claimed, leaving the published source
failing every query as unanswerable.
