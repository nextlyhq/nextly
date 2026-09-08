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

A generated create input may omit the publish status, and the lifecycle name is
reserved against column-less fields too.

The base artifacts state `status` as required because a read always carries one,
and the create artifacts are derived from them — so requiring it there made the
generated type and the generated validator reject an ordinary status-less
create that the API accepts and stores as a draft. The create artifacts now
drop it from the omit list and reintroduce it optional.

A column-less field named `status` — a component, or a many-to-many — was
accepted by config validation, because the column rules exempt fields that
occupy no column and returned before the lifecycle check. Such a field keeps
its declared name as its payload key, so the generated interface and schema
declared `status` twice and the generated file did not compile. The name is now
refused before that exemption, matched on the declared name, so a column-less
`Status` stays a distinct member.
