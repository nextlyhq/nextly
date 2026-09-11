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

Every drag surface in the admin now names what it is moving, and a drop back
onto the same row is reported as unchanged.

The select-field option list, the hooks editor, the repeater and component
rows, and the schema builder canvas still announced dnd-kit's generated ids
during a drag. They now say the option's label, the hook's name, "Gallery item
2", or the labels of the fields in a builder row -- "Picked up First name and
Last name, row 1 of 3". The option and hook drag handles are named after their
item; the hook handle had no accessible name at all.

Dropping an item where it was picked up -- Space twice, or a pointer released
over the original row -- used to announce that it had "moved to" its own
position. It now says it was dropped where it was and nothing moved, which is
what happened.

The schema builder canvas packed its rows two different ways: the list left
hidden fields out and gave a repeater or group its own full row, while the
reorder that consumed the list's row numbers did neither. With a hidden field
above, or a half-width repeater, dragging a row moved a different row. Both
now read one packing, so the row you drag is the row that moves.
