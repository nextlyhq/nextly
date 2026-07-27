---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

Media cards keep their metadata inside the tile, four more surfaces stay within their rounded corners, and the corner-radius guide now matches the components.

In the media library's grid view, a card's file size could paint outside the card border while its dimensions were squeezed to nothing. At the six-column layout this left the dimensions reading as a stray "1..", and a long label such as "Invalid size" spilled past the tile edge. The size is now always readable inside the card, and the dimensions appear once the card is wide enough to render both values in full, with a tooltip on the row carrying both at any card width.

Four surfaces painted a full-bleed child square across a rounded parent, which anyone running a nonzero `--radius` could see: the email-template segmented control, the component-row card header, the schema-builder field table header, and the code editor's validation error strip. `CardHeader` also gained the top-corner counterpart of the fix `CardFooter` already carried. All of these are unchanged at the shipped `--radius: 0`.

The slash command menu in rich text fields declared a stacking order that never took effect, so it could be covered by a dialog. It now sits above one.

The corner-radius tier tables in the theme and in the plugin authoring guide described a system the components do not implement, pointing plugin authors at the wrong step for alerts, table wrappers, checkboxes, icon buttons, switches and tabs. Both now agree with the code and with each other, they no longer offer `rounded-xl` and `rounded-2xl` as steps of the radius knob (the published Tailwind preset never exported them, and they do not go square at `--radius: 0`), and they state what `--radius: 0` actually resolves to for each step. A new test pins the contract so the documents and the components cannot drift apart unnoticed.
