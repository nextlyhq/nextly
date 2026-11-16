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

The admin is served as not listable by search engines, with or without a plugin that manages search.

- `nextly/config` exports `adminMetadata` (and the `ADMIN_ROBOTS` value it carries). New apps' `app/admin/[[...params]]/layout.tsx` exports it as the layout's Next.js `metadata`, which puts `<meta name="robots" content="noindex, nofollow">` in the head of the first HTML the server sends.
- An app made by an earlier release keeps working: the admin adds the same tag to the head in the browser where the page has none, so a crawler that runs the page still reads it. To have it in the first HTML too, add two lines to your admin layout:

  ```tsx
  import { adminMetadata } from "nextly/config";
  export const metadata = adminMetadata;
  ```

- A robots tag the page already has is left as it is, so no admin page carries two.
