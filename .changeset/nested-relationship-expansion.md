---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

Relationships nested one level deeper now expand for collections you defined in code, not only for those created in the Schema Builder.

`?depth=2` promises to populate a related document's own relationships, and it did so only for Builder-created collections. Resolving a target collection's fields read one of the two shapes those collections are stored in, so a code-first target resolved to nothing, the recursion guard failed, and the second hop was skipped silently at any depth — you got a bare id where a document was promised.

Two consequences, both now closed. A `depth: 2` read returns what it says it returns. And an access rule reading across two hops — `data.author?.organization?.suspended !== true` — was enforced on a Builder collection while being quietly unenforced on a code-first one, so the same rule over the same data gave different answers depending on how the collection happened to be defined.

Worth knowing if you use code-first collections with chained relationships: reads at depth 2 or more will now issue the queries that second hop requires, where previously they stopped early. Depth still bounds the walk, and a field's own `maxDepth` still overrides it.
