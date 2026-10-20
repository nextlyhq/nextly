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

A release now notes, for each document going live, the documents it links
to through its relationship fields that will not be live at the release's
moment: drafts nothing publishes by then, and documents another release takes
down before then. It is a soft problem, `UNPUBLISHED_LINK`, in the release's
readiness, and never stops scheduling, Publish now or the run. Adding a
document to a release answers with the same links as `unpublishedLinks`
(experimental), so a client can offer to add them too. A linked document the
caller may not read is never named, only counted. Uploads are never reported,
and links inside rich text are not checked yet.

`nextly.releases.addMember` now returns the member with `unpublishedLinks`
beside it; the member's own fields are unchanged.
