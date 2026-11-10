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

The admin's top bar now holds only the page's own place: its breadcrumb, and the panel toggle on a page whose panel starts folded. The notification bell (Inbox) and the account menu moved to the foot of the icon rail, the same on every page. Documentation, GitHub, Discord and the theme switch are in the account menu under "Help and community" and "Theme". A plugin's own header item (`header.slot`) stays at the top bar's right end on every page. A plugin's `header.hide` and `hideDefaults` hide the same items in their new places. Under `next dev` the rail keeps its foot clear below the avatar, so Next.js's development badge does not cover it, and on a short window the rail's entries scroll so the account menu stays in reach.

`useFoldedPanel` is exported from `@nextlyhq/admin` and from `@nextlyhq/plugin-sdk/admin` (`@experimental`), so a plugin's page can start with the content panel folded away.
