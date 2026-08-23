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

A design token's name is now bounded at `MAX_TOKEN_NAME_LENGTH`, on both sides
of a reference. The name grammar constrained the alphabet and not the length, so
a name of megabytes of otherwise-valid characters was scanned in full by the
pattern on every compile and copied into a `var()` on every rule that used it.
Bounding it also makes the stamp above sound for every string it reads rather
than for most of them: a token name reaches CSS through `scalarText`, so two
names agreeing up to the truncation point and differing after it compiled apart
under one identifier, and the stored sheet was then reused for the wrong one.
The cap is deliberately larger than the one on a class name, because a token
name is composed from a design-token file's nesting depth rather than typed.
