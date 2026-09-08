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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

The permissions UI now knows about content releases.

Adding `content-releases` as a system resource in core left the admin's four
copies of that list behind, so the permission was filed under Collections in the
role editor, mapped as per-collection access by the capability builder, and
rendered under the wrong bucket on the permissions page. Nothing threw — a
miscategorised permission simply shows the wrong thing, which is why a
role-matrix entry that quietly changes what preset roles can reach is worth
fixing as a defect rather than as tidying.

Content releases now sit with the editorial surfaces in the permissions page's
display order, next to media, rather than after the delivery and integration
entries: it is a tool an editor reaches daily, not infrastructure.
