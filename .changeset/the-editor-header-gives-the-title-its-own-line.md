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
---

The editor header is rearranged. The top row holds the way back to the
collection's list at the left and every action at the right, with History
first. The title has a line of its own below at full width, so it is no
longer cut to a few words wherever the actions take the width, and the save
state moves to a status line under it. Save draft, Unpublish and the other
secondary document verbs keep their words at every width: they draw no icon,
so at narrow widths they used to leave an empty bordered button. On a
phone, History and the preview move into the document's menu and the panel
toggle goes, so the actions keep to one row. The folded menu names each
preview action by what it does, and its trigger shows a shareable link still
being made. The document's status shows wherever the document panel is not
on screen, a phone included. The actions wrap within the editor's width, so
a preview pane or a feature's contributed controls never push them past its
edge. What each control does is unchanged.
