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

The tokens panel refuses to preview a value carrying a `var()`, because a reference
there resolves against the PANEL's own custom properties rather than the canvas's and
would draw a colour or a size the published page does not have. It asked that question
with a regex over the raw text.

A CSS function token is an identifier immediately followed by `(`, and the identifier
is read decoded — so `v\61 r(--nx-measure-wide)` is a `var()` to a browser and was not
one to that regex. It was previewed, resolving against the admin `--nx-*` namespace,
which resolves in the panel and which no published page emits. The preview was
confidently wrong rather than merely absent, which is the failure the guard exists to
prevent.

`referencesCustomProperty` is a new export from `@nextlyhq/blocks-engine`. It parses
the value and compares decoded function names, so it also sees a reference nested
inside a `calc()` or inside a fallback, and it answers "yes" for a value it cannot
parse — a caller is deciding whether to draw something, and declining to draw a value
that would not have rendered costs nothing.

It lives in the engine because the engine owns CSS semantics and already held every
part. Three modules had answered this question three ways, on purpose: `contrast.ts`
decodes, `dtcg.ts` reads raw and documents that a var() with an escaped name is then
read as invalid rather than dynamic, and `css-value.ts` had the parser and the decoder
but kept the comparison private. A fourth answer written in the panel would have been
the defect rather than the fix — and the raw reading that is safe in `dtcg` fails in
the opposite direction here, where unseen means drawn.
