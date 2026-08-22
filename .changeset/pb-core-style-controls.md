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

Give the page-builder style inspector unit-aware numeric editing and a two-state toggle, without narrowing what a style value may be.

Arrow keys step a measurement and keep its unit — Shift steps by ten, matching what Figma, Framer and Webflow all do — and a menu beside the field swaps the unit, offering only units the property itself accepts. A keyword property with exactly two values is drawn as a pair of buttons instead of a menu, so both options are visible and each is one click.

Every one of these is layered ON the existing text field rather than replacing it. A style value is stored as a string and may legitimately be `auto`, `clamp(1rem, 2vw, 3rem)`, a two-part shorthand like `10px 20px`, a CSS-wide keyword, or a design-token reference — so a control that modelled a length as a number plus a unit would write five of those six away the first time the field was touched. The affordances engage only where the stored value is a single simple measurement and disengage silently everywhere else, and whether a stepped or unit-swapped result is legal is decided by asking the engine with the property's own rules rather than by restating them.
