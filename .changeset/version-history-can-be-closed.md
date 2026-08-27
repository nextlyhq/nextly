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

Version history could be opened but not easily closed. The panel offered no
close control where one is normally found, clicking the page behind it was
deliberately ignored, and the only button that did close it sat in the row of
actions at the bottom — a row that gains three more buttons the moment a
version is selected, wraps at the panel's width, and carried that button off
the edge of the screen. Escape worked, but nothing said so.

The panel now closes from a control beside its title, where a dismissible
surface is expected to keep one, and it stays there whichever state the panel
is in. The action row no longer holds an exit, so the compare controls are
free to wrap onto a second visible line instead of pushing one off-screen, and
the row itself is gone entirely while no version is selected rather than
sitting empty below the list.

Nothing else about the panel changes: it stays beside the document rather than
over it, so the document it describes is still readable and scrollable while
history is open.
