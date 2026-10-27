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

A collection's `read` rule is now typed to answer a filter, typed by the collection's own fields: `defineCollection` checks each key and operator the rule's filter names, and the value each is compared with, so a misspelt field or operator fails to compile. The keys are the top-level fields declared with a field factory or inline, and the system fields; a path into a group is not typed yet. The new types (`CollectionRuleFilter`, `CollectionFilterRule`, `CollectionRuleAnswer`, `UntypedRuleFilter`, `CollectionFilterRuleInput`) are experimental.

Existing code compiles unchanged. The field factories that a filter can name (`text`, `textarea`, `email`, `code`, `number`, `checkbox`, `date`, `select`, `radio`, `upload`, `relationship`) keep the name as written, and still return their field's config type; a name built at runtime is a `string`, as before, and leaves the filter untyped. `CollectionConfigInput` takes two type parameters with defaults that keep its meaning. The stored `CollectionAccessControl["read"]` type now says what the runtime already accepted: a rule may answer `true`, `false` or a filter. Code that calls a stored read rule and reads its answer as a boolean should handle the filter case, or treat any answer other than `true` as a refusal.
