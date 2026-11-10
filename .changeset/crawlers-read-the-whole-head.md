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

Search engines and AI crawlers now read each page's whole head in the first HTML they are sent.

- `nextly/next` exports `nextlyHtmlLimitedBots`, for a Next config's `htmlLimitedBots`. It is Next.js's own list plus the main Googlebot and the AI crawlers and answer engines, such as GPTBot, ClaudeBot and PerplexityBot. Next.js streams a page's metadata to everyone else, after the head.
- A new app's `next.config` sets it, and `withNextly()` sets it where the app sets no list of its own.
- An app made earlier adds two lines to its `next.config`:

  ```ts
  import { nextlyHtmlLimitedBots } from "nextly/next";
  // in the config:
  htmlLimitedBots: nextlyHtmlLimitedBots,
  ```
