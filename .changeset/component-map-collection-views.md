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

The admin component map now holds every collection view, and the admin no longer imports plugin modules by name at run time.

- `nextly generate:types` and `--check` list the components a collection names for its own screens: its `Edit` and `List` views, and what is drawn before and after its list table and edit form. A plugin's collections and the site's own are both covered, and so does the development check that rewrites an out-of-date map, so it keeps them.
- The admin's run-time `import()` of a plugin's admin module is removed. In a bundled admin it could not resolve a package by name, so a component missing from the map now draws its fallback, and `next dev` names it.
- `registerKnownPlugin` is deprecated, and removed at the next major release after two minor releases. It still registers what it's given, now straight away, and says once that it is deprecated. Register components with `registerComponents` in your plugin's admin module instead. The plugin template and the first-party plugins now do.
- The generated map now registers through `registerComponentMap` (experimental, from `@nextlyhq/admin`). It registers like `registerComponents`, then tells the admin nothing more is on its way, so a plugin's document action or panel section whose component is missing draws its fallback instead of Loading. Rerun `nextly generate:types`: a map generated before this keeps working, but a component missing from it shows Loading instead of the fallback.
