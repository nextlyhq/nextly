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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
"create-nextly-app": patch
"nextly": patch
---

Red now means a deletion, and the Schema Builder speaks one plain language.

- **`AlertDialogAction` (`@nextlyhq/ui`) is primary by default.** It was red
  by default, so every dialog that confirmed a save, a publish or a restore
  looked like data loss unless its caller overrode the colour. It now takes
  `variant?: "primary" | "destructive"`, defaulting to `"primary"`. If your
  own dialog confirms a deletion and relied on the red default, pass
  `variant="destructive"`. The admin's own dialogs that delete data (a
  field's delete, a removal or a value-losing type change in the save
  review, a discarded draft, a copy over another language's values, a
  dashboard reset or replace) pass it.
- **The Schema Builder's save review is red only when the save deletes stored
  values.** The colour now follows the preview's rows, so a change that only
  needs an answer, a type change that keeps values, or values moving to the
  translation archive no longer shows a red save.
- **Field types have one plain name everywhere:** "Rich text" (was
  "Editor"), "Image or file" (was "Media"), "Link to entries" (was
  "Relationship"), "Repeating rows" (was "Repeater") and "Field group" (was
  "Field Group"). Type ids are unchanged; only what a person reads moved.
  The field settings sheet shows the plain name, not the internal id.
- **The Builder names the kind it edits** (collection, Single or field group)
  in its empty states, titles and messages, and writes titles, labels and
  buttons in sentence case, the confirming action last.
