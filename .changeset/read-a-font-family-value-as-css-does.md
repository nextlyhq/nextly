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

Read a `font-family` value the way CSS does, in four places it did not.

- A `var()` call is dynamic only when it names a custom property. CSS requires
  the first argument to begin with `--`, so `var(foo)` computes to an invalid
  `font-family` and the browser drops the declaration rather than falling
  through to the next family. Treating every `var(` as dynamic gave a dropped
  declaration an all-clear.
- Quoted family content keeps its spacing verbatim. `" Brand "` names a family
  whose name carries those spaces and is a different family from `Brand`;
  matching it against a face called `Brand` claimed a file renders that does
  not. Whitespace outside the quotes is still separation and still trims.
- A bare `default` is invalid rather than a whole-value keyword. Unlike
  `inherit`, `initial`, `unset`, `revert` and `revert-layer`, it is excluded
  from `<family-name>`, so the browser drops a declaration reading it bare.
- A comma inside `var(--font, Arial)` is not a family separator. Depth is
  counted rather than flagged, because `var(--a, var(--b, serif))` nests.

`emitTokenBlocks` now reports the tokens it wrote alongside the CSS and its
issues. It refuses a token on five separate grounds, and a caller asking "which
tokens does this site emit" had to restate all five — a second statement that
agrees today and drifts the first time one changes. The fonts panel reports on
that list, so a token the compiler refuses is no longer described as a typeface
the site renders.

The fonts panel draws a subset face with glyphs that face covers. A face limited
to a non-Latin `unicodeRange` renders none of the Latin specimen, so the row
demonstrated another subset or a fallback rather than the file it names.
