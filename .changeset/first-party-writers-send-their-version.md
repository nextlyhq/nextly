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

The Page Builder, the Form Builder, the blog template's seed and the API Playground now say, with every update they make, which version of the document they change, or that they set it whatever is stored. A write made from a read sends that read's `_rev`, so a change saved since is refused (`STALE_VERSION`, 409) rather than overwritten; a write that sets a value on purpose sends `_overwrite: true`. Experimental.

- **Page Builder:** component actions, the default Layout's settings, Layout removal and its repair, renaming from the Pages panel, shared styles, site fonts, the transfer import and the host rewrite send the version of the read they acted on. Putting back a stored copy, publishing what a page needs, making a Layout the default, and the Settings screen's breakpoints choose `_overwrite` (the breakpoints will send their version in a later change).
- **Form Builder:** marking a submission read chooses `_overwrite`, and still only touches a submission that is new.
- **Blog template seed:** patching a post's categories and tags sends the post's version; the Singles' demo copy chooses `_overwrite`, and a Single the seed cannot write now fails the seed with its reason instead of being skipped.
- **API Playground:** the generated SDK code reads the document first and sends its version with the update; a bulk body with `revs` becomes one update per id, each with its own version.
