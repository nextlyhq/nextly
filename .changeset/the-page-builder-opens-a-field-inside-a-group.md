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

**A blocks field inside a named group now opens in the Page Builder.** It counts at any depth of named groups, and the builder's address names it by its path from the document's root, as in `?field=hero.body`. Edits, saves, unsaved-work warnings and recovery points land at that path, and a top-level field that shares the field's name is left alone.

- **Repeaters:** a blocks field inside a repeater still has no builder. A row is addressed by its position, which names another row once the rows are reordered. Its card says so, and the startup warning now names only these fields, saying to move the field out of the repeater, to the top level or into a group.
- **Rules:** read-only, hidden and condition rules apply from every group around the field, each condition read at its own level.
- **Entry fields panel:** the panel beside the builder leaves out the field's top-level group, so the builder isn't drawn inside its own panel.
- **Locked content:** a save from the builder is checked against the locked content it started from. For a field inside a group, that check reads the field's own starting blocks only, so it's stricter than for a top-level field, never looser.
- **For plugin authors:** `DocumentViewProps` gains `fieldPath` (experimental), the field's path in the document form. Bind a field-type view through it rather than `field.name`, which names the field within its own group only. Nothing else changes for an existing view: a top-level field's path is its name.
