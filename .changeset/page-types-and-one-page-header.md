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

Admin pages now say what kind of page they are, and the frame gives each kind one width. A list runs the panel's full width within the gutter; a form is a 56rem column aligned under the page header rather than centred; an editor runs full width; a workspace takes no gutter. The Settings and Email lists lose their 72rem cap, and the role and webhook-delivery pages become forms.

`@nextlyhq/ui` adds `PageFrame` (`type: "list" | "form" | "editor" | "workspace"`), and `PageShell` takes `align: "start" | "center"`. The default is `start`, so a bounded column now sits under the page's left edge; pass `align="center"` to keep it centred. `PageHeader` gains a tab row (`tabs`, with `PageTabs` and `PageTab`, link tabs whose current one carries `aria-current="page"`), a leading visual (`media`), chips beside the title (`meta`), and `titleId` for a region named by the page's title. These additions are `@experimental`.

In the admin, `PageContainer` takes a `type` with the same four values; `width` keeps working. Every core page's title now comes from `PageHeader`, so each page has one `h1` drawn the same way.
