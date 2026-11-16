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

The admin remembers the map of the site on each editor's device, so a new tab draws the real rail and Content panel at once, before the server answers, then replaces them with what the server sends. It keeps only metadata: the menu as that person sees it, the schemas of the collections, Singles and field groups they read (a later read of one asks "has it changed?" and is not sent again when it has not), the site's public logo and name, interface preferences, and a note that someone signed in here; never an entry, a media item, a user, a form's values, a session token or a permission list, and no form is ever filled from it. What it keeps is labelled with the person, the admin build, the schema version and the permission version, and is discarded when any of them changes. Signing out, or the session ending, removes everything about the person in every open tab, which signs out too; only the public logo and name stay, so the sign-in screen keeps the site's look. Remembering is on by default; set `NEXTLY_ADMIN_DEVICE_MEMORY=off` to keep nothing on the device, and each browser removes what it kept on its next visit. Plugins keep an author's choices by the same rules through `devicePreferenceStore` from `@nextlyhq/plugin-sdk/admin` (experimental), which the page builder's editor now uses for its panels, recent pages and icons, template previews and getting-started card; `userPreferenceStore` from `@nextlyhq/builder/shell` takes an optional opener for such a store. The startup request's answer now carries `X-Nextly-Device-Memory`, `X-Nextly-Schema-Version` and `X-Nextly-Permission-Version` (a hash of the permission version) for this.
