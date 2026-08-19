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

A field that covers the whole entry form left its author unable to reach the rest of the entry.
The page builder opens full-screen over the form, so setting an SEO description or a publish date
meant closing the editor — and closing it discards its undo history.

The builder's left rail now offers a Settings panel holding the entry's other fields, rendered by
the form's own renderer through `useEntryFieldsPanel`. What the panel draws and what the form
submits are one thing; a second form instance would fork the state and lose whichever copy did not
save.

The asking field is excluded, and so is the field its `admin.condition` depends on: offering a page
builder inside its own settings panel would nest an editor in its own chrome, and offering the
control that un-renders it would be an unlabelled second exit.
