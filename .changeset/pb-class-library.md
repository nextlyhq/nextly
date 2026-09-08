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

The page builder can now answer, in one place, what its two class surfaces show and what an edit to
them produces.

Both surfaces ask the same rules, so a selector cannot decide a class is applicable while the
manager calls it unused. Ordering follows the library position that decides precedence rather than
the name or the stored array, because that order is what resolves a conflict between two classes on
one node - sorting for display would show an override relationship the page does not apply.

A class the library does not know is dropped from a node rather than drawn as an unnamed chip. The
engine omits such a class from the stylesheet, so a chip for it would offer to edit something no
page can display.

A typed name is held to the engine's own grammar rather than a second one, and a duplicate is
refused rather than merged: two classes with one slug emit the same selector, so the later would
silently override the earlier for every node carrying it.

Applying a class appends it rather than reordering to library position. The stored order does not
decide precedence, so rewriting it would produce a document change that renders identically - a
diff nobody can explain and a version-history entry that means nothing.

Deleting a class that documents reference requires a confirmation naming the count. The count is
read from an index maintained on write, which has no concurrency control and therefore errs upward,
so it warns about a deletion that was safe rather than waving through one that was not.
