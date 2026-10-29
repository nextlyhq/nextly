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

A reader can now pin up to 20 entries and Singles to come back to, from the "Pin to dashboard" item in an entry's or Single's "More actions" menu. Pins are kept per reader on the server (`GET`, `POST` and `DELETE /api/dashboard/pins`), so they follow the reader across devices; an API key cannot pin.

- A 21st pin is refused with a message naming the limit; pinning something already pinned is not a 21st.
- A pin needs read access to what it names. While a reader may no longer read a pinned entry, it is left out of their pins with no title and no placeholder, and kept, so it returns if their access does.
- Deleting an entry (one, several, or by query), a Single or a whole collection deletes every reader's pins of it, in the delete's own transaction.
- Before `nextly migrate` creates the pins table, a reader has no pins, a pin is refused naming the command, and deletes work as before: the table's presence is asked before the delete's transaction opens.
- The admin's `useDashboardPins` hook and the pin action are ready for the dashboard to draw pins (`@experimental`).
- A delete inside a transaction its caller holds asks whether the pins table exists on that transaction's own connection, so it completes on a pool of one connection. `DrizzleAdapter` gains the internal `tableExistsThrough`, the catalogue lookup `tableExists` makes, run on a given executor; `tableExists` answers as before.
