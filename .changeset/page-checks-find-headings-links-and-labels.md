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

Page checks now find more of what shuts visitors out, under Accessibility: a page with no main heading (Heading 1), more than one, or a heading that skips a level, read in page order with the site header before the page and the footer after; links and buttons with no words or only vague ones ("click here", "read more"), and an icon that links somewhere with no screen reader label; form fields with no label; and embeds with no title. An image whose picture comes from a field is listed as "may be missing" alt text. `runPageChecks` takes the header and footer documents as `regions`, and the Page checks count reads them from the page's set. Headings are judged from the renderer's page outline, inside the page's own components too, and `@nextlyhq/blocks-react` now exports `pageOutline` (experimental) for that.
