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

An access rule or a field's access rule that queries the database, and whose query waits out the pool's bound for a connection (`pool.connectionTimeoutMs`), now ends the request with a new error, `RULE_COULD_NOT_RUN` (503). It names the collection or Single whose rule it is, and the field for a field's rule, and carries the same retry hint as `DATABASE_BUSY`. Before, the wait read as the rule refusing: a publish was refused as forbidden, a field was silently left out of a read or a write, a related document read as missing, and a dashboard, a widget, release readiness or the capabilities answer quietly left the entity out. A publish that meets it rolls back and keeps its pending change, and a retry asks the rule again. A rule that throws for any other reason still refuses, as before. On SQLite, which keeps one connection, the same answer comes when a rule's own work queues behind a held transaction past `pool.connectionTimeoutMs`.

Every way in answers it the same: the Direct API returns or throws it, REST answers 503 with `Retry-After` and the request id, including when the route's own gate asked the rule, and `findByID` with `disableErrors` throws it rather than answering `null`. A dashboard widget's slot that meets it carries `code: "RULE_COULD_NOT_RUN"` with the subject, since a streamed batch has already answered. The refusal log records it with status 503, the code and the rule's subject.
