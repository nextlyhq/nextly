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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Text styles: named looks of typography only, worn by any block whatever its tag.

- A named class with `role: "text"` is a text style. It holds font, size (per breakpoint),
  line height, weight, letter spacing and case, and nothing else; the stylesheet leaves out
  one holding more, and the site record refuses it, naming the property.
- Text styles are written under `nx-t-<slug>`, after block styles and before shared styles,
  so a text style beats a block style's typography and never its colours or spacing.
- A Site text row may follow a text style (`textStyle`, the style's id). It then writes that
  style's whole look, at every breakpoint, on the canvas and on published pages; its own
  values come back if the text style goes.
- New engine exports, marked experimental: `isTextStyle`, `textStylesOf`,
  `nonTypographyProperties`, `TEXT_STYLE_PROPERTIES` and `TEXT_STYLE_CLASS_PREFIX`.
  `siteTextStyles` and `siteTextElementBases` take the site's classes as an optional last
  argument.

Compatibility: sites start with no text styles, and a site holding none compiles exactly as
before, so no stored page or sheet changes and nothing needs to be upgraded.
