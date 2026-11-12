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

Each form submission has a page of its own, at its own address, in place of the drawer the submissions list opened. It shows:

- the answers as the visitor was asked them, with option labels, dates in words, links, and files with name, size and download;
- fields a condition hid, marked as not asked;
- its activity;
- a side panel with its status, internal note and details.

Newer and Older move through the list it was opened from, keeping its filter. Opening a New submission marks it Read for a person who may update submissions. Staff edit answers there, except a consent.

Each new submission now keeps what it was asked (each field's label, type and option labels, and which fields its conditions hid), so it reads as it was answered after the form changes. It also keeps a title (who sent it, from a name or email answer), which the admin uses in breadcrumbs and lists. A submission stored before this reads with the form as it is now.

`SubmissionSheet` is no longer exported from `@nextlyhq/plugin-form-builder/admin`; the page replaces it.

Existing installations receive the new `asked` and `title` columns on the submissions collection through their own migrations: run `nextly migrate:create` and then `nextly migrate` (or `nextly db:sync` in development).
