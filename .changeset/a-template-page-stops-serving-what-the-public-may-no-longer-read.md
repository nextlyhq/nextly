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

A collection entry's page stops serving once the public may no longer read the entry. The content route (`createContentPage`, `createPublicContentPage`) now answers not found for an entry the public is refused (a denial, or a visitor asked to sign in), as it does for an unpublished one, where it used to answer 200 with a rendering error; any other failure still throws.

`cachedFind` keeps a read refused by access as its answer, rethrowing the refusal on each read of the entry. Next keeps a cached entry's earlier answer when reading it again throws, so a read the public was allowed before an owner took its permission away went on being served until some write expired one of its tags. And a change to what a role grants (its permissions, inheritance, slug or deletion) or to a permission row (an edit, or boot's seeding) now expires every collection's and Single's cache tags, as a change to the site's languages does, so a page shows the change promptly rather than at the end of its cache lifetime. A refusal is a denial (`FORBIDDEN`) or a visitor asked to sign in (`AUTH_REQUIRED`); another 403, such as an unverified email, is not one.

`nextly/runtime` exports `isReadRefusal`, the test the content routes use to tell a refusal from a fault, and `deferToRequest`. The access-enforced content route waits for the request before its uncached address lookup, so a Cache Components prerender no longer reports reading the current time there.
