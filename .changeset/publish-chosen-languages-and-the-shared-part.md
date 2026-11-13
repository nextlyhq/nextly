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

Publish or unpublish the languages of an entry you choose, and its shared part, in one request: `nextly.publish()` and `nextly.unpublish()`, and `POST .../entries/{id}/publish` and `.../unpublish` over REST (experimental). Everything chosen moves together or nothing does, and a refused request lists every part refused, each issue naming its language. A language can go live before the default one, taking the shared part with it on the entry's first publish; the shared part cannot be taken down while another language stays live; a publish of languages alone leaves the shared part's pending edits pending; and a unique translated field needs its own value in each language that goes live. `describe: true` answers what a request would do without doing it. A collection can set `requireEveryLanguage: true` (experimental) so each language must hold its own value for a required translated field. A validation issue now keeps the language it is in through the error envelope.
