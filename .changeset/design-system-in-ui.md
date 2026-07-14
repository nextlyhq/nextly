---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
---

The Nextly design system now lives in `@nextlyhq/ui` and is self-contained. You can style plugins and custom admin UIs two ways: import `@nextlyhq/ui/styles.css` for fully-styled, token-driven, dark-mode-aware components with zero Tailwind setup, or import `@nextlyhq/ui/theme.css` to build your own utilities against the token contract (tokens on `:root`/`.dark`, the `@theme` mappings, and the dark variant). Add the `dark` class to switch themes.

Control heights (Button, Input, Select) are now driven by a `--control-height` token scale, so control density can be tuned from one place; default sizes are unchanged. The admin renders identically to before — it now sources its tokens from `@nextlyhq/ui` with no visual change and no token leakage into the host page.
