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

Collection reads: give the list, count and by-id paths one implementation per concern, and apply the stored read rule's query constraint on all three.

A read by ID resolved its row predicate from the owner-only rule alone, while listing and counting resolved it from the access-control service's query channel. The two agree for an `owner-only` rule and nowhere else, so a `custom` read rule returning a query constraint filtered every listing and left a read by ID unfiltered — a row withheld from the list was reachable by its ID. All three paths now ask the same question, translate the answer through the same where-builder, and refuse a constraint they cannot fully express.
