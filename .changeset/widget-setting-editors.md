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

A widget's settings get the rest of what they were declared to do.

- **A setting's own editor** (`@experimental`): any setting builder takes `editor: { component: "<module>#<Export>" }`, drawn in the card's settings sheet in place of the setting's own field. The component is handed `SettingEditorProps` of the setting's value (the value, `onChange`, the card's other settings, and whether the sheet is saving), exported from `nextly` and `@nextlyhq/plugin-sdk`. Editors join the generated admin component map, which holds each one to its setting's value at compile time. A value an editor sets is held to the setting's own rules: the sheet names one that breaks them on Done, and the layout write refuses it (below). An editor is handed `undefined` for a setting with no value. Startup refuses an `editor` that names no component, one component used both as a widget's view and as a setting's editor, and an `editor` on a widget registered with `registerWidget` or contributed through `contributes.admin.widgets`, which says "custom setting editors need a defineWidget declaration" and names the widget and setting.
- **The layout write holds a card's changed settings to its widget's declaration**: a value of the wrong kind, outside a number's range, not among a select's options, or a Field naming a field the chosen collection does not offer the reader is refused with a validation error naming the setting. A value stored before its widget narrowed its declaration still saves unchanged.
- **A Field setting is checked before the card loads**: a field the chosen collection no longer has, or one its reader may not read, is replaced as the settings sheet replaces it: by the setting's default where the collection offers that field, otherwise left unset, so the card asks for the field again and its `load` never sees the stale value. The collections are read once per batch of cards, and a stored field is kept while the registry cannot be read. The rules are the settings sheet's own, now functions both use (`contentFieldFits`, `unfitContentField`, `startsAtDefault`, `staleValueTakesDefault` and `settingValueProblem` in `nextly/config`).
- **Prompts built from a setting's label are written in sentence case** on the server as in the admin: a card missing its Collection answers "No collection chosen yet". `noSettingChosen` and `settingInSentence` are in `nextly/widget-result`.
- **A day-only date keeps its day in every time zone.** The date input showed a day saved as UTC midnight as the day before to anyone west of UTC, and saved that earlier day on the next edit. Day, month and time-of-day values are now shown in UTC, the zone they are saved in, wherever the input is used: collection fields, user fields and widget settings. Date-and-time values are still shown in the reader's own zone.
