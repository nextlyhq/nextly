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

Builder: a placement destination now has ONE name. `@nextlyhq/builder` re-exports the engine's `PlacementTarget` instead of declaring its own `InsertTarget`, and the function that translated between the two spellings is gone.

`InsertTarget` remains exported from `@nextlyhq/builder` as a deprecated alias for one release and will be removed after it. Two things to know when migrating:

- The discriminant moved with the name. A target is written `{ kind: "root" }` and `{ kind: "slot", parentType, slot }`; the old `at` member is no longer accepted, and a value still spelling `at` is a type error rather than a silent fall-through. `DropRegion.at` and `DropTarget.target` hold these values, so a host narrowing them reads `.kind`.
- `@nextlyhq/blocks-engine` exports an unrelated type that is also called `InsertTarget` — where a saved pattern is inserted, `OpPosition | "document"`. That collision is what the deprecation removes: after the alias goes, `InsertTarget` names only the engine's pattern position.
