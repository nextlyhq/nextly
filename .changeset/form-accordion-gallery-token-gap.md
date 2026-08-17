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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

fix(blocks-react): stop three blocks depending on token CSS nothing emits

`core/form`, `core/accordion` and `core/gallery` each declared
`gap: { $token: "space.4" }`. A token reference compiles to
`var(--site-space-4)`, and nothing in this repository ever emits that variable,
so the declaration was invalid at computed-value time and `gap` fell back to
`normal` — zero for a grid. Three blocks rendered with their children touching.

Measured three ways that agree: `compileSiteSheet`, the only thing that turns a
token set into CSS, has zero consumers outside `blocks-engine`;
`emitTokenBlocks` is called only by that function, its own tests and a
benchmark; and the string `--site-` appears in no source file outside the engine
at all, against a positive control of `--nx-` appearing in four. So
`defaultSiteTokens()` guarantees nothing today — it is a default nobody applies.

Every existing check passed while this was broken: the property is in
`STYLE_CATALOG`, and the declaration did reach the compiled stylesheet. Whether
the `var()` inside the value RESOLVES is a third question, and nothing asked it.

The blocks now use the length `space.4` itself declares, so the value does not
change when this becomes a token again. `base-styles.test.tsx` gains the check
that asks the third question, walking to the leaf so a token nested inside an
object-shaped declaration is caught too, with a positive control for both
shapes. It is a ratchet with an expiry: when the site stylesheet is wired into
the render path it should be deleted by the change that wires it, rather than
weakened or exempted per block.
