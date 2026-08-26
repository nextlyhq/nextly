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

The page builder can now enumerate every class-usage subject one written document owns.

A save has to bring the index into agreement with the document that was just written, and
the unit the index is keyed by is not the document: it is the document CROSSED with a
locale and a variant. One save therefore owes an update to several subjects at once, and
which ones is a property of the collection rather than of the write.

The variants come from whether the collection stores a working draft beside its published
row. A collection without that split owns one variant, and asking it for a draft would
reconcile rows against a document that does not exist - filing the published classes as a
draft's, or deleting the rows of a draft the site never had. A collection with the split
owns both, because a pure draft edit leaves the published row untouched and the two forms
can apply different classes.

The locales come from the FIELD rather than from the site. A localized field stores one
value per locale, so it owns one subject per configured locale; a shared field stores a
single value every locale reads, so it owns exactly one subject under the empty locale key
that storage actually uses. Deriving both from the site's locale list instead would give a
shared field one subject per language, and each pass would then delete the rows the pass
before it had just written.

A collection is enumerated for every blocks field it declares, because a subject is keyed
by the field as well - two blocks fields on one document are two independent sets of rows,
and reconciling one against the other's classes removes references the document still makes.

This is enumeration only. Nothing calls it yet; the save hook that does follows.
