---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Editing a published entry's title no longer changes its URL. The slug follows the title while an entry is still a draft and stops once the entry has a public address, at which point it changes only if you edit it yourself. Previously a title edit silently retired the published address and every link to it started returning a not-found page.

An entry counts as publicly addressed in three cases, each of which was a way to lose a URL: it is published in the language you are editing (publishing is per language, so a live translation of a draft entry is protected and an untranslated language is not); it lives in a collection with no draft/published lifecycle, where saving is publishing; or you have published it at least once while the editor has been open, so unpublishing to make an edit does not put the address back up for grabs.

When you do change a public entry's slug, the editor says so before you save: the public URL changes and the old one stops working. That notice now also appears in the quick-edit form opened from a relationship field, and it clears once the change is saved rather than lingering against the URL you already replaced.
