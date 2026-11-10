---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-mcp": patch
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

The page builder has an Icon block. It draws one icon from the built-in Lucide set as inline SVG, rendered on the server with no script, sized by its font size and drawn in its text colour. Its Content tab has an Icon control: one button showing the chosen icon, which opens a search-first picker. A label makes the icon an image with that name; without one it is decorative and hidden from screen readers. A linked icon is named by its label, or by the icon's name. The canvas draws icons from the same set, loaded when first needed.

The icon picker can offer a "Recent" row of the icons a person used last, above the whole set, while the search is empty; the host keeps the list (`recentIcons`), and the page builder keeps one per signed-in author in the browser. An icon prop can be bound to an icon, text or select field. `@nextlyhq/blocks-react/icons/lucide` exports `lucideIconSource`, the set as a picker's source.
