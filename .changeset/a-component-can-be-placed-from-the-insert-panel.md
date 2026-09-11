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
Done — rather than as a could-not-be-loaded placeholder. A definition whose own
root is another component is judged for placement by what that component
draws, and the panel says when the library was too large to load whole.
