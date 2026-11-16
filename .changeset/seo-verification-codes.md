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

`@nextlyhq/plugin-seo` holds the codes Google, Bing, Pinterest, Yandex, Baidu and any other service ask a site to place in its home page to prove it owns the site, on **SEO > Settings > Connections**, and places each on the home page at every production address as an escaped `<meta>` tag. Pasting a whole tag or a DNS record keeps only its code; markup, a file name, a tag cut off and a name Nextly writes itself are refused with the reason. After a save, each box says whether the live home page carries its code yet. A page's head answer can now carry verification tags (`PageMetadataAnswer.verification`), which join any a route sets itself. Upgrading: the codes are a new field of the SEO settings, so a site that applies its schema with migrations runs `nextly migrate:create` and then `nextly migrate`.
