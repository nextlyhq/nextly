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

The Schema Builder's change dialog says what happens to a field's translations when it stops being translated.

- Before you save, the dialog lists each field leaving translation, how many translated values move to the archive and in which languages, and that the default language's value stays as the shared one. A field badge reads "no longer localized".
- A change that can't be made in one save is refused with the steps to take: a Required field can't stop being translated in the same change, so the dialog says to turn off Required and save, turn off Localized and save, then turn Required back on.
- The command that restores the archived values (`nextly i18n:restore`) is shown on one line, with a copy button.
- The dialog's Save button now uses the primary style rather than the destructive red, which it used for every change.
