---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Every signed-in person now has an account page, at `/admin/account`.

- It edits their own name and avatar through `/me` and shows their email, which an administrator changes. It needs no permission beyond being signed in.
- The user menu's "My Account" opens it. Before, it opened the users edit page, which needs `update-users`.
- Plugins can add blocks and tabs to it, at the `account` place, around its `profile` card.
- A person's own profile change through `/me` (and the Direct API's `updateMe`) is refused, naming the field, when its name or picture address is longer than 255 characters, the most every database stores. Before, MySQL refused such a save with a database error, or cut the value short. The limit now holds on every dialect: PostgreSQL and SQLite, which kept a longer value before, refuse it with the same message, so the same request gets the same answer everywhere.
- The account page sends only the fields you changed. A picture address stored before this limit, longer than 255 characters, is not sent again when you change only your name, so that save still goes through.
