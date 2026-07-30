---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Plugin-contributed field types are now first-class in generated output, in the manifest, and in the validation a plugin can reuse.

`nextly build` emitted nothing at all for a custom field type: the generators test membership of the built-in list, so the field was skipped while its value was still stored, leaving apps with no generated type and no schema entry for it. A type now states its own rendering through `PluginFieldType.codegen`, receiving the field as declared so a type whose options narrow what it stores can narrow what it generates.

A type's options can now be held in a `pluginOptions` container core never reads, so an option may use a name the field schema already declares — `options`, `fields`, `admin`, `label` — which was previously judged against the core meaning and refused. Options written directly on a field are still read, and a type is handed one flat view of both, so where an option was stored is not something a plugin author tracks.

A user field whose type a plugin contributed can now be declared from code with `pluginUserField()`, which was previously impossible without a cast: `UserFieldConfig` admits only the built-in shapes, and widening it to accept an unknown type token would have made a malformed built-in declaration pass too.

`validateFieldValues` is now available from the plugin SDK, marked experimental until a first-party plugin depends on it, so a plugin storing structured content of its own applies the same rules a write does rather than reimplementing `required`, the per-type checks, and every plugin field type's `validate`.

Two correctness fixes ride along. A key named `__proto__` was silently dropped when rebuilding an object from data nobody validates, which lost it from a delivered webhook envelope, from a stored version diff, and from the declaration a plugin validator judges. And `db:sync --watch` could classify one config's columns with another config's field types, because a reload replaces the process-wide registry while the previous sync is still running; work now resolves against the config it started from.
