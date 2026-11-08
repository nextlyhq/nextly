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

The blog template credits each post to a public author profile. A new `authors` collection holds the profile a reader sees: a name, a slug for `/authors/<slug>`, a bio and an avatar from the media library. Posts gain a `byline` relationship to it, while `author` stays the account that owns the post, so who may edit a post is unchanged. A new post is credited to its writer's profile when it has none, and a byline an editor chose is never replaced. The demo seed creates one profile per seeded user, with its avatar uploaded to the media library, and credits each post to it.

The post, author, category and tag pages read the author from the byline, so the author's link and avatar now show; before, the post page read the owning account, which carries neither. Existing scaffolded sites are untouched: the template is copied into a site when it is created, so this reaches new sites only.

The table of contents block's links are underlined, with hover and keyboard focus states, so they read as links on any site.
