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

An accordion's sections can now have a heading for a title, and the accordion has an icon of its own. On an accordion, **Titles as** (Content) draws every section's title as text or as a heading from level 2 to 6, inside its summary, so screen readers and search engines find each question in the page's outline. **Icon** (Style) offers Chevron, Plus, None or Browser default, and **Position** puts the icon before or after the title. Both are style values, so each can differ per device. The icon is drawn in the title's colour; the chevron turns and the plus becomes a minus while a section is open. It works with no script, and the browser's own keyboard and focus handling stay. New accordions show a chevron after the title. Sites on the classic spacing model keep the browser's triangle. `@nextlyhq/blocks-engine`'s exported `StyleGroup` union gains `"disclosure"`: code that switches over every style group, or keeps a `Record<StyleGroup, …>`, maps the new group.
