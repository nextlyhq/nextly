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

SEO can now be switched off for one content type from the SEO settings, without a schema change and without losing anything.

- The SEO settings hold a new list, `typesWithSeoOff`, of the content types whose SEO is off (a collection's slug, or `single:<slug>`). Every type is on until it is listed. Only someone who may change the SEO settings can change it.
- While a type is off, its entries have no SEO tab and the `seo` group is drawn nowhere on their pages. The plugin answers nothing for its pages, so each route serves only what its own code sets: no title pattern, no structured data, no social card, and no `noindex` of the plugin's. Off is not "hidden from search"; use the type's Hide from search for that. Its pages leave the sitemap and `llms.txt`, and the problem list shows none of their problems.
- Nothing is deleted. The column and every saved value stay, and the pages keep their addresses: a clash is still refused and a moved page still gets its redirect. Switching the type on again brings everything back as it was, without a redeploy. Values are only ever dropped by `nextly prune`, after the configuration leaves the type out.
- Pages lists the type's pages marked as SEO off (`standing: "seo-off"`), and the Overview's page coverage counts them as a group of their own (`seoOff`).
- The site's verification codes stay on the home page whatever its type's switch says.
- Upgrading adds one column to the SEO settings: run `nextly migrate:create` and `nextly migrate`. Until then every type reads as on.
