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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The class manager could be taken down by one corrupt class.

`NodeStyles` says states map to breakpoints map to values. A stored document only
promises to be JSON, and the usability gate admits a class whose `styles` is a plain
record without walking into it — so a persisted `{ base: { base: null } }` reached
`Object.keys(null)` and threw. Not one broken row: the whole panel, including the
rows an author would have used to delete the class that broke it.

Three shapes reached it, in two different functions — a null state map, a null
values map under any state, and a null base that got as far as the engine's
compiler and threw inside it. All three are now guarded with `isPlainRecord`, the
predicate the page compiler already uses for exactly this, at exactly these two
levels. The class is still listed, because repairing a corrupt entry is not this
panel's job and hiding it would take away the only row an author could act on.

A context that writes no rule is also no longer counted as behaviour. The row said
"1 more elsewhere" whenever a state or breakpoint held any key at all, including
keys naming a property the catalog does not define or a value whose grammar it
refuses — both of which the compiler drops. The count now comes from the compiled
declarations, so the caveat describes the stylesheet the visitor actually gets.
