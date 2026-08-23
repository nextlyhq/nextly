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
"create-nextly-app": patch
"nextly": patch
---

An inherited block-base entry is no longer turned into an emitted CSS rule.

`compilePageCss` emits a block type's defaults only when `Object.hasOwn` finds
the entry, because a node type reaches a SELECTOR and the compiler reads
persisted data whether or not anything validated it. Narrowing a stated
`blockBases` record to the types a page draws copied whatever the lookup
answered — so a record reached through `Object.create`, or one whose prototype
had been polluted, had its inherited entry made an OWN property of the narrowed
record, and the compiler then emitted a rule it had deliberately declined to
emit.

A style value longer than `MAX_VALUE_LENGTH` is also read no further than the
compiler reads it. The engine refuses such a value before parsing and emits no
declaration, so two of them produce identical CSS — carrying both in full
invalidated a byte-identical stored stylesheet over a suffix nothing reads, and
put an arbitrarily large allocation into every cache check. `MAX_VALUE_LENGTH`
is exported so a writer can honour the same number.
