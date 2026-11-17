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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The Style tab says in one line of chips what a style change will affect: "● This block" in pink, or "◆" and a shared style's name in green, then the device the canvas shows (its tooltip says which devices a change reaches, and that the device is chosen in the top bar), then the state, amber when it isn't Normal. The first chip opens a menu that is always the same: this block, each shared style the block uses with Detach and Remove, then "Apply a shared style…" and "Save as shared style…", each greyed out with its reason until it can be used, so nothing in the panel moves after the first edit. Wearing a block style no longer adds lines to the bar; choosing a shared style adds one line saying where it's used and that changes there change all of them. While a state other than Normal is edited, the settings are tinted and say "You are editing the Hover look. Normal stays as it is." The tab row and the bar stay in view while the panel scrolls. The bar's colours are new `--nx-builder-target-block`, `--nx-builder-target-shared` and `--nx-builder-target-state` tokens (with `-ground` pairs and a `--nx-builder-target-state-tint`), defined for light and dark; the unused `--nx-builder-local` token is removed.
