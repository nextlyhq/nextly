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

A field changing between translated and shared now keeps what every reader sees, and says so first.

- **The shared value is the one readers saw.** When a field stops being translated, an entry's shared value comes from the default language where it's live; otherwise from the first live language in the site's language order; otherwise from the default language's draft; otherwise from the site's order. Previously an entry with no default-language value took the first language by code, which could be a draft no reader saw. Every other language's value is archived, and `nextly i18n:restore` brings it back.
- **The summary names whose page changes.** The Schema Builder's preview counts what goes to the archive with the same rule, and lists the languages entries take their shared value from. A field becoming translated now has a summary too: how many values become the default language's.
- **Password and virtual fields can't be marked translatable.** A configuration that sets `localized: true` on one is refused, naming the field; it was quietly stored as shared. The Schema Builder no longer offers the switch on a password field.
