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
---

An entry can now be edited beside the page it becomes. A new control in the editor
opens a preview pane: the editor keeps the left of the screen, the site renders in a
frame on the right, and the divider between them moves.

The frame is an IFRAME rather than the page redrawn inside the admin, and that is the
decision the rest follows from. A frame is a real browsing context with a real
viewport, so the site's own responsive rules resolve exactly as they do for a visitor,
and its document is the site's — nothing the admin styles reaches in and nothing the
site styles reaches out.

It shows the last SAVED draft, and says so on the toolbar rather than leaving an
author to infer it. Saving refreshes it. Autosave does not, and cannot: autosave
records a private per-author recovery point while the preview reads the working draft,
so the two are different rows and moving one changes nothing the other can show.
Making them the same thing would let anyone holding a preview link read half-typed
content, which is a decision about who sees unfinished work rather than a refresh
strategy.

Opening the pane releases the editor's 56rem measure by ASKING for it, the way the
page builder asks, rather than by the page declaring a second width — so a reader who
never opens the preview gets exactly the page they had. The admin's navigation stays:
this is a pane beside the editor, not a surface that took the window.

The credential is minted when the pane opens and re-minted only as it approaches
expiry. An ordinary refresh remounts the frame, so watching a page through a long edit
does not issue a bearer credential per save.
