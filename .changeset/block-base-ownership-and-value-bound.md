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

A block type is bounded at `MAX_BLOCK_TYPE_LENGTH` before its grammar runs, for
the same reason and by the same measure. The engine now also exports
`EMITTABLE_STRING_BOUNDS`: every bound on a string it can write into CSS, as
data rather than as prose. A consumer that digests compiler inputs has to keep
enough of each string to tell two apart whenever they compile differently, and
the list of which strings those are had been kept twice as a comment — short by
one both times.

Registration, document validation and compilation now share one block-type
predicate, `isBlockType`, exported from the document model. The three carried
identical copies of the grammar, so a bound added to one accepted a name the
others rejected: a block could register and validate while the compiler omitted
its declared defaults, rendering without the look it declares and reporting
nothing.

The shared-input stamp's encoding is bumped, and its contract now covers what
the COMPILER emits as well as what the stamp serializes. A stamp keys on inputs,
so it cannot see the compiler treating unchanged inputs differently — a stored
stylesheet would otherwise be served for a compile that no longer produces it.

A custom-property prefix is bounded too, and the block-name cap now reaches the
generated block manifest and its published JSON Schema. Without the second,
`nextly generate` accepts a declaration `registerBlocks` refuses at boot, which
is the opposite of what an artifact describing a plugin's declaration is for.
The manifest restates the cap rather than importing it, as it already does for
the block-version bound, and the engine-parity test holds the two equal.

`isBlockType` and its cap are also exported from `@nextlyhq/blocks-engine/format`,
so a generator reading the document format from the lightweight entry can apply
the same rule instead of deciding independently what a node type may be.

The emission cap applies to a token's IDENTITY rather than to its display name.
A token's identity is its id when it has one, so a renamed token emits under
that id and its name reaches no stylesheet — capping the name would have deleted
a working token from the site sheet the moment an author gave it a long label,
and a rename is meant to cost nothing.

Both DTCG gates follow the same identity rule as the emitter, through one shared
answer rather than a third copy of it. Without that, a renamed token with a long
label was silently dropped from an export and refused on the way back in, while
Nextly went on rendering it.

A token name's DEPTH is bounded as well as its length. The DTCG exporter writes
one nested group per dot-separated segment and the reader walks those groups, so
a label deep enough produced a file this package could not read back — an
exporter emitting a document that fails its own round trip. Bounded separately
from length because depth is the property that breaks, and a renamed token's
label is deliberately free of the length cap.

The builder's rename gate follows the same rule, so the editor no longer refuses
a label the engine accepts, and `EMITTABLE_STRING_BOUNDS` lists the literal
style value — the largest bound of the set, and the one whose omission let a
consumer verify every listed bound and still choose a limit below it.
