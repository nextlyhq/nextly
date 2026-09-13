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
"@nextlyhq/plugin-mcp": patch
---

A function default cannot read a denied sibling from inside a group or a repeater row either.

The create path judges the field rules on a copy of the request and hands that copy to the function defaults, so a default cannot read a value its writer was not allowed to send. When the rules removed a whole container, the copy had no counterpart for it, and the walk read that as no copy having been given at all: it fell back to the caller's own row, which is exactly the unfiltered data the copy exists to replace. A nested default could then carry a denied sibling into a child the caller may write, while the pass that decides what is stored removed only the field it came from. A container missing from the copy is now read as a container the rules emptied, which is the only way one goes missing.

A Single's first read judges a required nested child by the rule the write validator will apply. `required: true` on the field and `validation: { required: true }` beside its other rules are both supported spellings, and this read tested only the first, so a group invented for one defaulted child was stored with a required sibling empty and the next write refused the document. The validator's own predicate is shared now rather than restated.
