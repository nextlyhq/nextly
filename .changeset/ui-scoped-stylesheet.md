---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
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

Add a stylesheet for using the UI components inside an existing application.

`@nextlyhq/ui` previously shipped one compiled stylesheet, and it styles the whole page: it includes Tailwind's preflight, which resets headings, lists, form controls and spacing document-wide. That is what a new app wants, and it is why the kit could not be dropped into an app that already has its own design — importing it restyled everything around the components.

`@nextlyhq/ui/styles.scoped.css` confines every rule to a `.nextly-ui` wrapper, so the components still get the normalised baseline they are built against while the rest of the page keeps its own styling. Put the class on any element and everything inside it is styled; dark mode goes on the same element.

The plugin styling guide now also explains why a plugin compiles its own CSS ahead of time rather than relying on the host to scan it, and the README documents which of the three stylesheets to reach for.
