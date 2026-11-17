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

A new site now starts with a plain starter header and footer (experimental). The page builder's first default header & footer set on a fresh site is called **Main** and holds a published **Starter header** and **Starter footer**: the site's name (or "Your site name"), links to up to five pages, oldest first, and a **Contact us** button to `/contact`; and a footer with the name, a **Pages** column of up to four pages, and "© <current year> <site name>". They are built only from core blocks, with every colour and spacing step taken from the site's design variables, so they follow its light and dark colours. In the builder they are tagged "Starter header · edit or replace" and "Starter footer" until a change to them is published.

What an existing site will notice: nothing. The starter is created once, on a site that never had a default; sites that upgrade keep their default as it is. A default the plugin has to re-create later is an empty set, and a site set to draw its header and footer in code (`siteHeaderFooter: "code"`) gets an empty **Main** and no starter, as does a site that keeps its components in a collection of its own (`componentReadiness.collection`). A newly created default is now called **Main** (`main`) rather than "Site layout"; existing ones keep their names.

The site binding source gains a read-only **Current year** (`currentYear`), in the site's time zone. The page route works it out where it reads the site settings, inside a cached read, so pages still prerender under Cache Components, and a cached page shows the new year within a minute. The binding engine never reads the clock itself: a host drawing pages of its own hands the year in with the settings (`siteComputedValues`, and the `BlocksSiteValues` type).
