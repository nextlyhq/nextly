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

A component delete's rewrite now asks the person who started it only for what their own save would need. Each copy is written as that person, under every rule their update meets (update access to the entry or Single, the field's update rules, and the publish permission where the write publishes), and what the write expects to find is judged as the system that read it. A starter who may update a page but not read it, or whose field read rule closes the blocks field to them, no longer has the rewrite refused or stopped; one who may not update it is still refused.

The rewrite also no longer saves a page's live content as a draft when the author discards the draft while the page is being read: the page is read again and written as it now stands. The same holds when the draft is published and a new one saved between the two reads: the row's version is compared across them.

`updateIfUnchanged` (`@experimental`) takes a new identity, `{ caller, checkedBy: { overrideAccess: true } }` (`PluginSystemCheckedWrite`, in `PluginConditionalWriteIdentity`), for a write whose expectation the system read: the update is the caller's and the expectation's read is the system's. Made as a caller alone, it still refuses a field they may not read, so nobody learns whether a value they supplied matches one.

A person's conditional write is now refused with `FORBIDDEN`, writing nothing, when what it would persist, after every hook, does not hold each field it writes exactly as sent, or the field-access pass took one out (a field update rule refusing it, or a hook changing or putting back its value). An ordinary update drops such a field silently and writes the rest, so a conditional write could have been reported as made while its field never changed. A component delete's rewrite reports such a document as not permitted.
