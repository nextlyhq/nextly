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

The page builder's Design routes no longer refuse an author because another save of the site style landed while they ran. Locking or removing a shared style, removing a variable and adding a font each write with the version they read; when another save landed in between, the route now reads again, checks again on what is stored and makes only its own change there, up to three times in all, so both changes are kept. A removal is still refused when the newer copy makes it unsafe, such as a style locked or a shared style now using the variable, and a font face another add stored meanwhile is not stored twice, its extra files deleted. After three refusals the route answers the stale-version conflict as before. Putting back variables a page started using retries only on that conflict. Added fonts go into one "Fonts" media folder even when several server processes add fonts at once: the folder is claimed in the page builder's own options table, a process that loses the claim deletes the empty folder it made, and a claimed folder that was deleted is made again. No migration is needed.
