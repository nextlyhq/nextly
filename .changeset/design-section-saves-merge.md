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

Two authors editing the site's design at once no longer lose each other's changes. The editor's site style read now answers the document's version, and each save of the variables, shared styles or fonts sends it, merged onto the newest stored copy: entries are matched by their identity and merged field by field, so a token, style or font added or changed by someone else is kept beside the author's own change, and a lock that landed meanwhile still holds. When another save lands first, the editor reads again, merges again and saves, up to three times in all. Where both changed the same value, a save keeps the author's value and an undo or redo keeps the other person's; the save answers which entries those were. The Variables studio no longer drops a token added elsewhere while it was open, and every studio shows what was stored after a merged save. A server that gives no version is written to as before.

The editor now says when a Design save met someone else's change to the same entry. The Variables panel shows a status line beside its error line, naming the variables ("Sam changed Primary while you were editing. Your value was kept. Undo puts theirs back."), with a Reload button that reads the variables again and drops the panel's own copy; it clears on the next edit. Shared style and font saves show the same words in a warning toast with a Reload action, and an undo or redo that met a newer change says that part could not be undone or redone. The person is named only when exactly one save came between, otherwise "Someone". A save refused after every try says the site's design kept changing, so it was not saved. A save merged cleanly shows nothing. Warning toasts across the admin now draw their text from the theme, so it reads at 4.5:1 on its surface in the light scheme (it read at about 3:1).
