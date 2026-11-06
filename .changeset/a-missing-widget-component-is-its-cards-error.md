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

A dashboard widget whose component is missing from the app's component map now draws its own
card's error state, and the rest of the admin serves. Production no longer reads, checks or
writes the map: the admin's server layout does nothing there, and no longer refuses the admin
over a missing widget component. In development the map is still written again when it falls
behind; where it cannot be (`NEXTLY_GENERATED_FILES_WRITE=0`, or a folder that is not writable)
the server log names each missing component, its owner and the fix instead of refusing.

The card's error names the widget, its owner and the missing path in development, and says only
that the component could not be loaded in production. The grid counts the card as failed.

New: `nextly generate:types --check` compares the committed map with the config and writes
nothing. It exits 1 naming each missing component and each path no longer declared, and 2 when
it cannot load the config. Run it in CI.

The error code `NEXTLY_ADMIN_COMPONENT_MAP_STALE` is gone with the refusal it named. The widget
definition gains an `owner` that core publishes for a widget drawn by its own component;
`registerWidget()` and `overrideWidget()` refuse it, as they refuse `serverData`.
