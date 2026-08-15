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

Make one control size name mean one control height.

`size="sm"` resolved to `--nx-control-height-md` (36px) on `Button` and `--nx-control-height-sm` (32px) on `Input` and `SelectTrigger`, so a small button beside a small input or select sat 4px out of line. `default` and `lg` already agreed; only `sm` diverged.

Input and select now take the same step as button. Nothing changes visually today: there was not one `<Input size="sm">` or `<SelectTrigger size="sm">` anywhere in the repository, which is why the divergence survived — it was waiting for its first call site rather than showing up on a screen. Aligning the other direction would have shrunk sixty live buttons to fix a case nobody had hit yet.

A test now calls the exported `cva` functions and asserts that every size name shared by these primitives resolves to the same height token, and that the steps stay ordered. It reads the class string a caller actually receives rather than parsing the variant maps out of the source.

The admin sidebar's search field asked for `h-9` directly, which happened to equal the small step and then stopped tracking it. It takes `size="sm"` now, and its icon is centred rather than offset by a fixed `top-2.5` that only centred inside a 36px control — the same height decision written a second time.
