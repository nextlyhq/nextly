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

Emails can carry the site's brand without editing HTML. Brand settings (a logo and its width, an accent colour, the background and content colours, a font from an email-safe list, and footer text and links) are stored by core and read by `GET` and `PATCH /api/email-templates/brand`, which take the permissions to read and to update email templates. Core's default layout is now written in them, the buttons of core's built-in emails take the accent, and every layout and template can read them as the `brand` variable (`brand.html` holds the logo, footer and link markup they make). A background or content colour a site chooses is kept in dark mode too, where the default layout used to swap in fixed dark colours.

Nothing changes for an existing site until someone changes a setting: each setting starts from what the default layout showed, which renders every email byte for byte as before. On upgrade, the default layout and built-in emails still as core shipped them move to the new versions; ones a site edited stay as they are, as do the site's own layouts. `GET /api/email-templates/brand` says which emails the settings reach and why the others are not reached. In a layout's data, `brand` is always the settings: a send's own `brand` value still reaches the template body, but no longer a layout, and a template whose send supplies no `brand` reads the settings. A template kept on the engine before Liquid now writes HTML marked as trusted unescaped, as Liquid does.
