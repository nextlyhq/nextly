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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A plugin route can compute the permission it requires.

`requiredPermission` took a fixed slug, and a permission slug spells a
collection — which the host can rename. A route gating on one of its own
plugin's collections therefore had to choose between demanding a grant nobody
was seeded on the installs that renamed it, or declaring no permission at all.
The page builder's save-pattern route chose the second, so a write was reachable
by any authenticated caller.

It now also accepts a function of the plugin's own resolved names:

```ts
requiredPermission: ({ collection }) => collection("patterns", "create"),
```

The scope composes the slug through the same helper core seeds with, so a route
never spells one itself, and the demanded grant follows a rename. A resolver
that throws refuses the request rather than falling through to the ungated path.
