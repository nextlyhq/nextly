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

A page's address may now hold several segments, such as `docs/getting-started/install`, so pages can sit beneath one another. Each segment is normalised as a one-segment slug is, and an address with an empty part, a `.` or `..` part, a part with nothing left once normalised, and any address naming a reserved path or longer than 255 characters, is refused at save with the reason on the slug, never rewritten. It is an experimental per-collection option, `db: { slugPaths: true }`, which the page builder's Pages collection sets: a rule about the stored value only, with no schema change or migration, so every existing one-segment address is kept and other collections still strip `/`. `previewUrlFromTemplate` takes an experimental `pathFields` option naming the fields whose values are such paths: their slashes are kept and each segment encoded, so a nested page's Preview and address name its real address; every other value is encoded whole, as before. A copy of a nested page stays beside it, and the page's Settings say how to nest it.
