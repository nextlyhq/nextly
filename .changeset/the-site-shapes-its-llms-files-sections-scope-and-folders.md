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

SEO plugin: shape llms.txt and llms-full.txt from the settings. **Search engines and AI** now lists llms.txt's sections (each content type, every Single's page under Pages, and pages built in code by their folder, "Other pages" at the root): rename, reorder, merge by giving two one heading, list under the `## Optional` section (written last, as the llms.txt proposal names the links AI tools may skip), or leave out of both files while the sitemap keeps them. It adds sections of the site's own links, checked to be links in plain words; chooses what llms-full.txt holds (every page, chosen sections, or addresses starting with a path such as `/docs/`) and its size (1–5 MB, 5 by default), with a new Problems warning when it stops short; gives a folder its own `/docs/llms.txt` and `/docs/llms-full.txt`, which `withNextly()` now rewrites to plugins (`folderLlmsFiles: false` turns that off); and previews llms.txt before saving. Each content type lists its fields under "In plain-text copies" to leave one out of copies and llms-full.txt, and a field declared with `custom: { seo: { copy: false } }` is always left out. The choices are a new `aiFiles` field of the settings Single: a site that applies its schema with migrations runs `nextly migrate:create` and `nextly migrate` after upgrading.
