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

Lets an author remove a CSS id that is present but empty.

The renderer treats the modelled field as present whenever it is a string, so a
stored empty id renders `id=""` and hides any `id` set in the attributes beside
it. The inspector collapsed that state into an absent field, so the box looked
empty, every attempt to clear it read as no change, and the id could never be
removed — a state only an import or a script can create, and then not undo.

The three states the document distinguishes now survive being read, and removing
an empty id is an explicit action that appears only in that state and says
whether it is about to reveal an id the attributes were holding. Cleaning it up
on sight, or folding it into an unrelated save, would change the anchor a page
renders without the author asking.
