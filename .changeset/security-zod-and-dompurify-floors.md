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

Security: zod moves to 4.6.7 and DOMPurify to 3.4.17.

- zod before 4.6.6 could run out of memory validating a very large array against an array schema without a length limit (GHSA-mrhx-c7xc-m3w5). Every package that validates input with zod gets the fixed version.
- DOMPurify before 3.4.17 had sanitizer bypasses in its `SAFE_FOR_TEMPLATES`, DOM-output and `IN_PLACE` modes (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr). Nextly's SVG upload sanitizer uses none of those modes, so it was not affected; the floor still rises, so no install can resolve an affected version.
