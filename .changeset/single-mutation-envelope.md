---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/plugin-form-builder": patch
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

**Breaking (Direct API):** `nextly.updateSingle()` now returns the same `{ message, item }` mutation envelope the collection mutations return, instead of the bare updated document. Read the document from `.item`:

```ts
// before
const settings = await nextly.updateSingle({ slug: "site-settings", data });
settings.siteName;

// after
const { item } = await nextly.updateSingle({ slug: "site-settings", data });
item.siteName;
```

This makes every mutation report its outcome the same way, and gives a single's post-commit hook failures somewhere to be reported: the result carries the same optional `warnings` array a collection mutation does. Singles run the same after-write phases as collections, so previously a hook that threw after a single was saved was logged and never reached the caller.
