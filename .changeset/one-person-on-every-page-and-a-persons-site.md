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

The SEO plugin describes each person a site names as one person, with one `@id`, on every page: a new People list (SEO › Settings › People, or the `structuredData.people` option) holds each person's or team's name, other names, page, photo, job title, bio, profiles, topics, workplace and identifier, and a founder, a post's author named by a relationship or as text, the default author and a profile page's subject are matched to it by their page's address or the same name. An identifier given for a person on another site is the one every reference names, so one person can be named the same way across several sites. The organization names its founders on every page, not only the About page, and founders now go by their People `@id` rather than `<home>#founder`. A team can be described as an organization, and an author named as the brand is the site's own organization. A new "A person" kind of site makes a personal site: the person publishes it, the home page is a profile page about them, and no organization is described. People is a new field of the SEO settings: a site that applies its schema with migrations runs `nextly migrate:create` and then `nextly migrate` after upgrading.
