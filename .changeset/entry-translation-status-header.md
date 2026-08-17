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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(admin): show translation progress as one instrument

The entry editor described the same fact in three places: a language switcher
in the header, per-language status pills in the document rail, and a
completeness badge in the list. An author had to assemble "where am I, what
state is everywhere else, and how far along is this document" from three
fragments two panels apart.

The pills now sit beside the switcher with a completeness bar and a written
count, as one strip. The document rail keeps the ACTIONS on other languages
(copy from another language, publish all) — those are document management
rather than status.

The count is derived once by `translationCounts` and read by both the bar and
the header's spoken status region, so the two cannot drift. A language present
in the entry's translation map but no longer configured is ignored rather than
counted, which previously made "5 of 4" reachable.
