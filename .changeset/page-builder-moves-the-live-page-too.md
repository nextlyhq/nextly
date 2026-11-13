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

The Page Builder now moves a published page on its live copy too, where before
only its draft moved. Removing a Layout with "Move N pages, then delete" (or
unpublish) clears the Layout from each page's live version and from its pending
draft in one field rewrite, and deleting a component that pages use turns its
copies into plain blocks on the live copy and the draft together. Each draft
stays a draft, so nothing an author hasn't published goes live, and the page's
History records the change as made through the Page Builder, with the reason.

Changing a live copy needs the right to publish the page. For a person who may
edit a page but not publish it, the draft moves as before and the live copy is
left: a Layout removal still finishes, and its dialog names those published
pages so someone who can publish them knows where to look; a component delete
keeps the component until the page is published, as before.

A page saved while it is being moved is read again and tried a few times, then
reported if it keeps changing.

A field rewrite also reads the collection table on its own transaction now, so
on a PostgreSQL or MySQL pool of one connection a rewrite of a collection this
process had not read yet no longer waits on itself.
