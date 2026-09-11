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

The insert panel offers the site's components beside its blocks and patterns,
and placing one writes a single instance node that keeps pointing at the
definition — nothing is copied into the page. Component definitions now reach
the editor through a route of their own, `GET …/library/components`, gated by
the components collection's read permission and answering the canonical
`{ items, meta }` envelope. It lists every lifecycle state the caller may read,
so a never-published component can be placed on a draft page, and reads each
definition by id AS THE USER so an author who may edit a component sees its
working draft while one who may only read it sees the live definition. The
canvas and the entry form's resting miniature both resolve instances against
them, so a placed component renders in the builder — and stays rendered after
Done — rather than as a could-not-be-loaded placeholder; both wait for the read
and say when it failed, with a way to try again. A definition whose own root is
another component is judged for placement by what that component draws, under
the site's own document caps, and the panel says when a tier of the library was
too large to load whole or could not be read.

The component tier is read in the language the surrounding document is being
edited in, as the public page reads it, so a localized component draws on the
canvas as it will on the page; and a row without a title — a custom collection
with none, or one field-level access redacts — is offered labelled by its id
rather than left out.

The Direct API's `findByID` now forwards `status`, so an untrusted by-id read
can reach a row that was never published — a caller passing it before was
silently ignored. A plugin route's caller gains `identity()`, which resolves
once per request the identity an access rule is evaluated against — the user
with their roles, and an API key's scope — so a route reading through the
Direct API on the caller's behalf reads as the caller its own gate admitted;
`PluginRouteIdentity` names its answer in the SDK.
