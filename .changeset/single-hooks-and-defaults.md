---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

Honour a Single's declared hooks and field defaults

Two documented parts of the `defineSingle()` config silently did nothing:

- **Hooks** — `hooks: { beforeRead, afterRead, beforeChange, afterChange }` were
  never registered, so none of them ran. They now register (via the scaffolded
  init helper, alongside collection hooks) and execute on the single read and
  update paths. `beforeRead` remains side-effect-only, matching collections.
- **Field defaults** — a `defaultValue` on a Single's field never applied; the
  first read auto-created the row with `null` in every defaulted column, because
  a function `defaultValue` cannot survive serialization to `dynamic_singles`.
  Defaults are now resolved from the live code-first config, so a scalar or
  structured (group/repeater) default lands on the auto-created document.
