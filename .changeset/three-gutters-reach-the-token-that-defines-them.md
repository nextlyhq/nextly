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
---

A row of columns laid out a grid and left the gutter at zero, so the one block
whose whole purpose is side-by-side content rendered its columns touching.
Measured on a published page: three tracks of 427px with nothing between them.
It now has a gutter.

That gutter is `space.4`, and so are the gallery's and the accordion's. Both of
those shipped with the same token, both rendered their children touching, and
both were changed to a literal `1rem` — because nothing turned a token set into
CSS, so the reference compiled to a `var()` with nothing behind it, the
declaration was invalid at computed-value time, and `gap` fell back to `normal`,
which is zero for a grid. Each of the three carried a note saying the literal
stood only until the site stylesheet reached the render path. It now does, so
the notes are honoured and the literals retired.

Nothing about the rendered result changes, because `1rem` is exactly what
`space.4` declares. What changes is that a site retuning its spacing scale now
reaches all three, instead of finding a second answer hardcoded in each block.
A page's stored content is untouched, and an author who set their own gap still
wins, since authored styles outrank a block default.
