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

A site's own dashboard widgets, declared in `admin.dashboard.widgets`, are now registered and
offered like a plugin's, and `defaultLayout` may place them; startup no longer warns that they
are checked but not applied. Their components are listed in the generated component map, by
`next dev`, `nextly generate:types` and its `--check`, under the site config's name. A site names
a component relative to its config file (`"./dashboard/notes#NotesCard"`), which the map imports
from its own folder, or by a package name; a path alias is refused at startup with the relative
spelling to write instead. Widgets a plugin's `setup()` adds to the site's dashboard are listed
too, as the running server registers them. In development a map whose config has moved is
written again, so a component named relative to the config resolves from its new folder.
