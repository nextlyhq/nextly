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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

**The `@nextlyhq/ui` Button's `link` variant changes colour.** Its words were drawn in the primary colour (`text-primary`); they are now drawn in the text colour (`text-foreground`) and underlined at rest, with a thicker underline on hover in place of the underline that appeared only on hover. Every `<Button variant="link">` takes this unless it sets its own text colour in `className`, which still wins. The primary colour is a fill a site's brand may set to anything, and as small text it can fall under WCAG AA's 4.5:1: under an indigo brand (`#6366f1`) the old link read 4.33:1 on a light page, 4.22:1 on a dark popover and 3.80:1 on a dark warning alert. In the text colour it reads at least 16.9:1 on each of those, in light and dark. To keep the brand colour on a link button, pass `className="text-primary"` and check its contrast on the surfaces it sits on.
