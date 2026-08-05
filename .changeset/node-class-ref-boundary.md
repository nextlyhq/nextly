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
---

A reusable block keeps its own node classes.

A resolved `core/ref` rendered its target using the containing document's class
map. That map is keyed by node id, and a stored subtree can hold an id the
document also holds, so a referenced node could take a class belonging to a
different node and be styled by rules compiled for it. Referenced subtrees are
outside the walk the map is built from, so they now take their plain class.

The Query Loop sample preview in the editor renders the same template through the
production renderer and was naming nodes the other way, so it disagreed with the
editable template above it wherever a class had been disambiguated.
