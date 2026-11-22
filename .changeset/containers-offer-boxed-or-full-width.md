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

Every container offers **Content width** in Style › Layout: Boxed or Full width, as two picture buttons, in place of the "Constrain content width" checkbox. Collection list and Entry content offer it too. A new Section starts Boxed; every other container starts Full width.

The line under the buttons says what is in force: "Boxed to 1152px · site default", or "Content runs edge to edge." **Change for this section** gives one container a width of its own, typed or picked from the site's variables, stored in a new optional `contentWidth` prop. **Use site default** takes it away. The width applies to that container only: a Boxed container inside it still boxes to the site's width. Content width is one value on every device and state, so it is held while a shared style or a state other than Normal is edited.

The page compile writes a container's own width as `--nx-content-width` in that container's own rule. The site stylesheet resets the property to the site's width on every element, and its content-width rule reads it first. The engine exports `CONTENT_WIDTH_PROP` and `CONTENT_WIDTH_PROPERTY` as experimental. A stylesheet stored before this reads the site's width alone, so it is recompiled on its next read, not served.
