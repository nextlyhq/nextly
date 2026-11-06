---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

A dashboard widget declared with `defineWidget` now reads its data only through its `load` function, run on the server for the person asking. Its read services read as that person, so two people see what their own access allows. **Breaking:** the `load: { query }` form is removed, along with the `ContentQuery` type the package root exported. A widget still using it is refused at startup with a message saying `load` must be a function. Move the query into a function that reads with the `count` and `find` services it is handed: `load: async ({ settings, services }) => ({ total: await services.count(settings.collection) })`.

Each card is now decided in order before its data is read. A person who fails the widget's `access` gets the card's "not available" state, and `access` may now be a permission name, `{ collections }` (every collection must be readable by the person, renamed collections included) or a function of the person; a function that throws counts as no access and is logged. A card missing a setting its widget needs draws "Choose <setting> in the card's settings" as its empty state. A widget's `shows` function is now judged per card: when it answers false, the card is left off that person's dashboard and out of the update count, and customise mode shows it marked "Not shown for you right now". A data function that throws, runs past its time budget or answers a value JSON cannot carry fails its own card only, and the cards beside it are still drawn. The log names the plugin, the widget and the reason; the plugin's own error message and stack are logged only in development, since they can hold data.
