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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Customising the dashboard opens a bar that stays at the top of the page while
you scroll, with Add widget, Reset, Cancel and Save, a note when you have
unsaved changes, and the reason inside it when a save does not go through, with
Try again or Reload. Focus moves to the bar when you start and back to Customize
when you finish, and each step is announced to screen readers. While you
customise, the cards' own links and buttons are dimmed and out of reach, so a
click or Tab goes to the card controls instead.

Leaving the dashboard with unsaved changes asks first, with Save Changes,
Discard Changes and Keep Editing. Saving from there leaves only once the save
has gone through; if it fails, or the dashboard changed elsewhere, you stay with
your changes kept. The entry and Single editors keep their own prompt.

Confirming that you want to leave after pressing Back now actually leaves.
This applies everywhere that asks before you leave with unsaved changes: the
entry and Single editors, document views and the dashboard. Before, confirming
discarded your changes and kept you on the page. Back and Forward now also hold
the page until you answer, and Forward goes where you were headed instead of
one page further.
