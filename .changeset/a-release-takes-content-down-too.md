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

A scheduled release now takes content DOWN as well as putting it up.

Scheduling an unpublish did nothing. The decision was resolved correctly — the
code knew the document was due to be withdrawn — and then only the publish half
was passed to the read paths, so the ordinary `status = published` filter went
on returning the row the release was supposed to retire. Collection listings,
Single reads and relationship expansions all apply both directions now.

Release visibility is decided from DOCUMENT-WIDE members only. Per-locale
lifecycle is not stored on the row this filter applies to: a localized document
is public through its main row or through any one of its translations, and
publishing or withdrawing a single language writes that language's companion row
and deliberately leaves the main row alone. Applying a one-language decision to
the whole document contradicted that in both directions, so it no longer
happens. Scheduling a release for one language is not yet supported and cannot
regress anything today, because releases have no write surface.

A single read also resolves releases against ONE instant, and a listing's count
now shares the instant its rows used, so a release becoming due mid-request
cannot produce a page whose rows and total disagree.
