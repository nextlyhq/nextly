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

The pane toggle says what clicking it will do again. A collection that declares
no preview label was handed the defaulted "Preview", so the button read
"Preview" in both the open and closed states instead of "Show preview" and
"Hide preview". The declared label now travels and absence is preserved, which
is what lets the button and the pane each apply the wording its own sentence
takes.

Choosing "Custom width" always opens the box. It commits a seed width, and where
a site declared a viewport at that same width — 1280 is the seed and an ordinary
desktop tier — the control resolved it as that preset and never showed the
input, so a custom width could not be entered at all.

A named viewport is previewed at exactly the width it declares. Widths are no
longer rounded, so a site can offer 767.6 — and reading the chosen option with
`parseInt` sized the frame to 767, one side of the site's own
`@media (max-width: 767.6px)` boundary, then matched no viewport and showed
"Custom" for an option just picked by name.

A fractional custom width no longer reads as invalid. A number input steps by 1
unless told otherwise, so the browser reported a committed `390.5` as a step
mismatch while the preview was using that exact width.
