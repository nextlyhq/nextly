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

Repeaters and groups that keep their text per language, on the roads that manage tables:

- `nextly migrate:baseline` adopts a translations table holding a repeater's or group's overlay column, recording it as the container's overlay. It refused every such project before, as holding columns the project no longer describes. When it does refuse a column nothing describes, its advice now offers `--adopt-unknown`, which keeps every column, and says that dropping a column deletes its text in every language.
- A Schema Builder save after one that added a repeater or group with text inside is no longer refused as schema drift over that container's overlay column.
- A repeater or group renamed in the Schema Builder on an entity that is not translated keeps its text under the new name.
- Changing a translated text inside a repeater or group into a type that is not translated (a number, say) is refused for now, naming the field and its container: each language's text there would be left behind. A change between two translated types, and a change of a shared field there, go ahead as before.
- A field kept once for every language (a number, a shared text) can be moved into or out of a repeater or group that keeps its text per language again; a translated text still cannot be moved there yet.
