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

`@nextlyhq/plugin-seo` lets a site add its own lines to robots.txt on **SEO > Settings > Search engines and AI**, served after the plugin's own and never in their place. A rule keeping every crawler, Googlebot or Bingbot away from the home page or the whole site is refused, pointing to Hide from search; a rule blocking pages the sitemap lists names them and saves only once confirmed, and each such page is an error on the problem list while the rule stands. Misspelt rules are warned about, lines that are not standard rules (such as `Content-Signal`) are kept with a note, a group naming an AI crawler is explained as joined with the AI tools choice for it, and the screen says when the site serves its own robots.txt. The tab also says that robots.txt can't take a site out of Google's AI Overviews or AI Mode. Upgrading: the rules are a new field of the SEO settings, so a site that applies its schema with migrations runs `nextly migrate:create` and then `nextly migrate` after upgrading.
