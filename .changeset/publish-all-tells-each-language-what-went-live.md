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

Publishing every language of a localized Single now records, for each language, the events a publish of that one language records. A language that was already live and whose pending change goes live gets a `single.updated` event tagged with its locale; before, it got none. A language going live for the first time gets a tagged `single.updated` as well as its tagged `single.published`; before, it got only `single.published`. For the default language, the untagged `single.updated` and the tagged one both describe the write.

Each event's `previous` now holds the content readers saw before the publish. Before, it was built from translated values read after the pending changes were promoted, so it already held the new text.

When a pending change edited a field every language shares, the version a publish of every language records, and each event's current state, now hold the shared value it put live. Before, both kept the value from before the publish.

You can now ask what publishing every language of a Single would do before doing it: `GET /api/singles/{slug}/publish-all`, or `previewPublishAllLocales(slug)` on the Single service. It lists every configured language with its outcome: `goes-live-with-pending-change`, `stays-published`, `goes-live`, `shows-fallback` (naming the language it falls back to), or `out-of-date` (naming the shared fields you may read and counting the others). It also lists what would refuse the publish as a whole: edits two languages made that can't be combined or ordered, and a pending change the publish's own checks refuse, because it edits a field you may not write or would leave the document invalid. It's asked as the publish is: a caller who may not publish is refused. Publishing every language now returns the same `languages` list with its result.

Publishing every language of a collection entry now puts each language's pending change live, as publishing every language of a Single already did. Before, it moved every language's status and left the pending changes pending. It judges the changes as a Single's publish of every language does: a change behind newer shared values is refused naming the fields, as are shared edits that can't be combined or ordered, and each change must pass its validation and the caller's field write rules. If any change is refused, nothing goes live. Each language's webhook subscribers get the events a publish of that language alone sends (a tagged `entry.updated`, plus the status events where it goes live). Its history records the move from draft, and the result lists each language's outcome. A collection publish of every language whose entry falls outside a write rule's filter is now refused with 403 before anything else is judged; before, an invalid pending change could answer 400 first.

You can ask the same of a collection entry before publishing it: `GET /api/collections/{slug}/entries/{id}/publish-all`, or `previewPublishAllLocales({ collectionName, entryId })` on the collections handler. It answers with the same language outcomes and the same blockers as a Single's preview, judged by the same checks the publish runs, and refuses a caller who may not publish.

Publishing every language whose translations table is missing, for a collection or a Single, is now refused with 409 and the repair to run, as a write of one language is. Before, a table dropped while the app ran answered 500, and once the app noticed, the publish put only the main row live.
