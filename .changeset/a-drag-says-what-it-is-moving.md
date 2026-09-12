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

Every sortable table in the admin can be reordered from the keyboard, and a
screen reader is told what is being moved.

Two tables -- the collection fields list and the user fields page -- accepted
only a pointer, so a keyboard user could not reorder them at all. They now use
the same sensors as every other drag surface: Space or Enter picks a row up,
the arrow keys move it, Space drops it, Escape puts it back.

What a drag says has changed on every surface. The defaults read the
draggable's id aloud -- "Picked up draggable item 3f9a…" -- and every id here
is a field name or a uuid. A drag now names the thing and where it sits:
"Picked up Title, position 1 of 4", "Title is over Body, position 3 of 4",
"Title moved to position 3 of 4". On the dashboard the same sentences name the
card and its column, matching what the Move buttons already say, so a card
moved by keyboard and one moved by button sound the same. Each drag handle is
also named after its row, so tabbing through them no longer reads as a list of
identical buttons.
