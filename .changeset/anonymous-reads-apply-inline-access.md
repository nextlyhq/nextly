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

The guidance for anonymous content reads described a limitation that no longer
holds, in the direction that matters: it said inline `defineCollection({ access })`
code rules are not applied without a user, and told readers to gate such content
behind an authenticated read.

Those rules ARE applied now. A code rule reads what it is handed, and an
anonymous caller is something it can be handed, so it receives `user: null` and
no roles and decides on that. A rule written `read: ({ user }) => !!user` hides
the content exactly as its author intended.

What an anonymous read still cannot apply is a row-level CONSTRAINT rule,
owner-only or a custom rule returning a query predicate. Those compare a row
against somebody and there is nobody to compare it to, so the guidance to use an
authenticated read stands for them and now says so specifically.

Both copies are corrected, in `resolveContent`'s own contract and in the routing
guide. Two tests hold the claim at the point that decides it, including a
control that no inline rule still means the stored rules decide.
