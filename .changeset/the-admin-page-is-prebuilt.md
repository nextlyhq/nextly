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

The admin page is now prebuilt: the same page for every visitor, built with the app and served at once, even while the server is still starting Nextly.

Before, the admin was rendered for each request and marked `private, no-store`. Now it is served from the build with headers a CDN or the browser may keep. Nothing about the person is in the page, and it reads nothing from the database. Everything about them still comes from the admin's own requests once it loads.

The logo, name and favicon set in `admin.branding` are written into the page, so they show from the first paint with no swap after it loads. The favicon's link is in the first HTML. Branding set only in General settings still arrives with the admin's first requests.

Nextly's cache handler now serves the pages `next build` prerendered. Before, it kept entries only in memory, so a new server process (every cold start) found none of them and rendered every prerendered page again on its first request. Now a miss is answered from the build's files, which are judged by the same tag expiries as any other entry, so a write made since the build still expires them. Every app using `nextly/cache-handler` gets this.

New apps get this from `create-nextly-app`. To update an existing app's `app/admin/[[...params]]/layout.tsx`:

- export `metadata = adminMetadataFor(config.admin?.branding)`, which replaces `adminMetadata`;
- add `generateStaticParams` returning `[{ params: [] }]`;
- render the branding element from `adminBrandingJson`, all three from `nextly/config`;
- move any per-request work into development-only code, as the installation guide shows.

A layout that keeps a request-time `connection()` around the admin keeps working, but is rendered for each request as before.
