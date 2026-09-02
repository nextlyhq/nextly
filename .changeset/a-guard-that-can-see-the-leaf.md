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

Two guards on the core blocks' default styles could not fail on the broken code they
existed to catch. Both were found by review, and both were verified by writing the
broken implementation and watching the suites stay green.

A token written at a leaf that refuses its KIND was accepted. The check asked
`tokenKindsForProperty`, which returns the union across a composite property's
leaves — for `border` that union is `dimension | color`, so a colour token in
`border.width.blockStart` passed while the browser drops the declaration. The
question is now put to `validateStyleValues`, which answers it per leaf.

It is asked DIRECTLY rather than through `compileStyleValues`, which was the first
attempt and reported nothing: the compiler keeps only error-severity issues to
decide what to refuse, and a kind mismatch is a warning, so it emitted the dropped
declaration with an empty warnings list. That is also why no production check
catches this — the validator has the answer, the compiler discards it, and a block
default is compiled with no token table at all.

A property declared with NO value was also accepted. `border: {}` counts as a
declared property with zero leaves, and the comparison was "fewer emitted than
expected", which zero of zero is not. Emptying the button's border removes the reset
that keeps a `<button>` and an `<a>` the same shape, and every suite stayed green. A
declared property carrying no leaf is now a defect in its own right.
