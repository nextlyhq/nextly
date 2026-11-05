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

Publishing and unpublishing every language, batch and bulk updates, restoring a version, taking the live values into a pending change, and discarding a pending change are now judged by the version their caller read, as a save is. Each is refused with `STALE_VERSION` (409) when the document changed since, and changes nothing. `_overwrite: true` applies it anyway and records the overwrite in the document's history. A request that gives no version is applied as before. Experimental.

- **Publishing or unpublishing every language** (`POST …/entries/{id}/publish-all` and `/unpublish-all`, `POST /singles/{slug}/publish-all`, and an update with `locale: "*"`) is judged on every language. Send `_rev` and `_overwrite` in the request body. The version must be one a read of every language returned (`7.en:2,es:3`). A one-language version is refused with 400, since it can't say whether another language changed. The answer gives every language's new version.
- **A batch that gives each document its own version** (`updateMany`) reports each out-of-date document as a conflict and applies the rest. Each conflict's error carries its current version in `data`, and, where the caller may read the document, who changed it and when.
- **A bulk update by ids** (`POST …/entries/bulk-update`, `bulkUpdateEntries`) takes a version for each id in `revs: { "<id>": "<_rev>" }`, and judges each document on its own. A `revs` that leaves out some of the ids is refused with the new `VERSION_REQUIRED` (428). A bulk update by query can't take `revs`. A bulk update that gives neither `revs` nor `_overwrite: true` is still applied for now.
- **A restore** (`POST …/versions/{n}/restore`, for an entry or a Single) takes `_rev` and `_overwrite` in its body, and answers with the document's new `_rev`.
- **Taking the live values** (`POST …/versions/working-draft/take-live`) takes `_rev` and `_overwrite` in its body.
- **Discarding a pending change** (`DELETE …/versions/working-draft`) takes them in the query string (`?locale=es&_rev=7.es:3&_overwrite=true`). For plugins, `ctx.services.versions.deleteWorkingDraft(ref, locale, opts, version)` takes a new optional fourth argument, `{ _rev, _overwrite }`.
- **A body that is not an object** sent to publish-all, unpublish-all, restore or take-live, which those routes used to ignore, is now refused with 400: it can't say which version the request was made from.
- **A release's run** and **autosave** are never judged. A release moves each document as it stands when it runs. A recovery point changes no version.
