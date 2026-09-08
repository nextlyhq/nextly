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
"create-nextly-app": patch
"nextly": patch
---

The class selector now appears in the style inspector, above the style
sections, so applying a class happens on the element being styled rather than
behind a context switch. Until now the surface existed and nothing rendered it.

Applying or removing an existing class is written by the inspector itself,
because it is an edit to the selected block and the panel already writes those
— a host only supplies the site's class library and handles creating a new
class, which needs a site-style write no panel can reach. Removing the last
class removes the field rather than storing an empty list, so undo restores the
block as it was.

A host that has not opted in gets no class surface at all, and one that has
opted in but is still reading its library gets a loading state, so the two are
never drawn the same way.
