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

Colour controls in the page-builder style inspector: a swatch that opens a picker beside the field that owns the value, a token picker over the site's colour tokens, and a WCAG contrast readout for a text-and-background pair.

The text field remains the control. A stored colour may be `oklch()`, `color-mix()`, a named colour, `currentcolor`, a CSS-wide keyword or a `var()`, and none of them is rewritten by opening the picker — the swatch and the readout offer themselves only where the value can be resolved here, and show nothing where it cannot.

Choosing a token stores the token's IDENTITY rather than the name shown, so a reference keeps resolving after the token is renamed; a stored reference is displayed under the token's current name.
