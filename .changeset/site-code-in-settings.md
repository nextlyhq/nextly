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

Site code can now be edited in the page builder's Settings, under Site → Code (experimental). The section says what each place holds in plain words and who changed it last. Saving checks the code first: what can't be stored is named under its place and nothing is saved; what the site's Content Security Policy would block is listed with what to add to the policy, ready to copy, and is saved only once you confirm; with no policy known, the section says so before saving.

The site code read now also answers `described`, `changedAt` and `changedBy`, and each policy check answers `additions`, from the new `siteCodePolicyAdditions`. Under `'strict-dynamic'`, scripts the loader builds are trusted once the loader is allowed. The head's code finishes loading before the end of the body's starts.
