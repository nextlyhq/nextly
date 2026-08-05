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
---

Add `Slider` to `@nextlyhq/ui`, under the experimental tier.

A bounded numeric property — opacity, blur radius, letter spacing, a colour's
alpha — is the single most repeated control in an editing surface, and every
plugin building one would otherwise reimplement it privately. `<input
type="range">` is nearly unstyleable and cannot express two thumbs; a hand-rolled
replacement gets pointer capture, step rounding and the per-thumb ARIA pattern
wrong quietly. This wraps the Radix primitive, which is already the kit's
vendor, so it adds no new dependency shape.

`value` is an array even for a single thumb — that is what makes a range slider
the same component rather than a second one. Commit expensive writes from
`onValueCommit`, which fires once the drag settles, rather than `onValueChange`,
which fires on every frame of it.
