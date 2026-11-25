---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Repeaters, groups and components keep one structure across languages:

- A repeater's or group's rows, their order and their shared values are the same in every language, and the text inside each row is translated on its own, kept with its row by the row's id. Reordering, adding or removing a row in any language applies to every language, and a removed row's translations go with it. A component placed in a container's rows is translated with its row.
- **Breaking config change:** `localized: true` on a repeater, a group or a component field is refused when the configuration loads (`FIELD_STRUCTURE_NOT_TRANSLATABLE`), in a site's own config and in a plugin's alike. The fix is one line: remove it from the container and mark the fields inside `localized: true` instead; `nextly migrate` keeps each language's values. The SEO plugin's `seo` group does this itself now.
- In a held change, a structure change is the shared part's and goes live with any language's publish; a text change inside a row, or inside a component's instance, is the language's own.
- `nextly migrate` converts content an earlier release kept whole per language where every language has the default language's structure, refuses and names each document whose languages differ (the dry run lists them too), takes the flag off the Schema Builder's definitions, and splits pending changes holding such a field by part, keeping a group one brings into being or a row one adds inside a group's list. A pending change holding text on a row or component instance with no id is refused, naming the document and field (publish or discard it, then run `nextly migrate` again). `migrate:create` renames a container's translations column with the container, where the rename is accepted. Turning translation on in the Schema Builder, or a code-first sync making or extending a translations table, keeps a container's text as the default language's. An edit turning a field group's field translated or shared is refused while a repeater or group places that field group, naming where. A Schema Builder change leaving a repeater or group with nothing translated inside is refused, naming it, since its text in every language would be lost. The SEO plugin leaves a custom component, field group, password or virtual field in its `fields` untranslated, as the configuration requires.
- The editor tells a container whose rows hold translated text apart from a shared field, fills a text inside a row from the same row of the source language, and copying from another language copies the text inside rows onto this language's own rows.
- Each instance of a repeatable component held inline in a row or group now carries a stable `id`, kept on reorder, so its translations stay with it. `localized: false` on a repeater or group shares it whole, as on any other field.
- Known limit of this release: turning translation off for an entity whose repeaters or groups keep text per language is refused (`migrate:create` names the entity and each container), since that text, in every language, would be lost. Keep translation on for that entity until a later release brings those translations back when it is turned off, or remove those containers first if their text can go.
- Known limit: a repeater declaring its own `id` field keeps each row's text per language only where that id is set and unique in the list; other rows keep their text shared across languages. The declared `id` itself is never translated, whatever its type.
- A cleared (blank) translated text inside a repeater or group now reads as `null`, as a translated top-level text already does: a blank translation is no translation and falls back to the next language, ending at `null`. An untranslated value keeps what was stored. Where a whole container was translated before (the SEO plugin's `seo` group among them), a cleared text there read as `""` and now reads as `null`.
