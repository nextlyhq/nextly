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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The page builder now reads the document a class-usage subject names, in the lifecycle state and
the language that subject is keyed by.

The variant is named through the LIFECYCLE FILTER rather than the by-id read's draft flag. That
flag is documented as effective "only on a drafts-enabled, non-localized collection", and
drafts and localization are not mutually exclusive - so on a localized collection it did
nothing and every draft subject silently read the live row. The filter is authoritative and
also constrains the localized companion's own status, which is what makes a per-locale draft
addressable at all.

A subject with a real locale asks with FALLBACK OFF. Fallback is on by default, so a language
with no translation resolved the field from its fallback chain, and the resulting classes were
filed under a translation that does not exist. Every subject derives from its own stored
translation, or the per-locale model the reconciler and the rebuild share stops being true.

A read that cannot be performed now RAISES instead of answering empty. Errors were suppressed
for every unsuccessful result rather than for a missing row alone, so a failing read hook was
indistinguishable from an absent document.

Because absence is now a definite answer, a subject with no document reconciles to ZERO rather
than being left alone. That is what removes the rows of a working draft that has since been
published or discarded: leaving them kept every class that draft once applied recorded against
a document that no longer exists in that variant, which blocks deleting a class the surviving
document does not use.
