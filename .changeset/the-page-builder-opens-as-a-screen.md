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

The Page Builder opens as a screen of its own, at the page's own address:
`/admin/collections/<slug>/<id>/builder`, or `/admin/singles/<slug>/builder`
for a Single. Before, it opened over the entry form. A reload keeps the author
in the builder, a link to it can be shared, and Exit editor goes back to the
page's form. The admin holds the page's soft lock, the offer to restore unsaved
work, and the question before leaving with unsaved changes. Saving a pattern no
longer saves the page as well. If a colleague takes the page over, the author's
unsaved edits stay in their form until they take it back.

A page that has never been saved has no address yet, so its Page Builder card
asks the author to save it first. The Page Builder edits the default language:
opened from another language's edit screen, it opens the default one, and the
card says so.

**Compatibility.** The Page Builder now opens only for a blocks field at the top
level of a collection or a Single, including one inside an unnamed group.

- **Who is affected:** a site that declares a blocks field inside a named group
  or a repeater. That field's card still shows the page, but offers no way into
  the builder, and startup logs a warning naming the collection and the field.
  The warning covers fields declared in code; for a collection made in the
  Schema Builder, the card is what says it.
- **What to do:** move the field to the top level of its collection or Single
  to edit it visually, or keep it where it is until nested fields are
  supported.

The builder is a document view at the `builder` address on every document
with a top-level blocks field, so another plugin declaring a document view at
`builder` is refused at startup, naming both plugins.
