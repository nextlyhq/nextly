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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

The Schema Builder shows a collection's, Single's or field group's fields as one outline, every nested field included: each row names its label, its type, its name and badges for Required, Translatable, Hidden, Has a condition, Locked (naming where it is defined) and Has an error. Containers fold, and Fold all and Unfold all are remembered for each entity in the browser; a find box shows the fields matching a label, name or type with the containers above them opened. A hidden field stays in the outline, marked Hidden, and can be shown again. A field that uses a field group shows that field group's fields beneath it, read-only, with a way to open the field group in its own editor; a blocks field shows how many blocks it accepts. A field owned by code or a plugin, and every field beneath a field group, offers no change in its menu, the panel or by key, and says where it is defined. Selecting a row opens its settings without moving the outline. An optional form preview shows the entry form as editors will see it, pending changes included. The outline is a tree to assistive technology, with the tree's keys; a row's actions open from its menu (Shift+F10), and "/" adds a field after it.

A field moves within its own container by dragging it, or with Move up and Move down in its menu (Alt+Up and Alt+Down).

Fixed: a field named `title` or `slug` inside a group or a field group is no longer treated as one of the entity's built-in fields, so it shows in the outline and can be edited and deleted. A field group's resolved fields, which the server adds when it hands a definition out, are no longer written back into the field's options on save. Every field with an error is now marked, at any depth; a field without a name inside a group is refused at save as one at the top level is.
