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

A `group` or `timeseries` read given a `null` key answered with an unclassified
500 instead of naming the problem. The validator treated `null` as "no key
given" while every read that consumes it decides absence with `=== undefined`,
so the value it excused was still a key by the time it reached the column
lookup, and the crash arrived through the one input the guard had waved past.
Both API arguments are required strings, so nothing can mean "absent" by
writing `null`; it is now refused by name.

A localized date is refused by ONE rule rather than two. The read path and the
widget validator each decided separately that a localized field cannot be
grouped, and the day localized aggregation becomes supported they would have
disagreed — the read accepting a key the validator still refused, leaving a
path no author could reach. Both now ask the same leaf, which imports nothing
so the validator can reach it.

A widget source declaring a `bucketable` flag that is not a boolean is refused
when it registers. Query validation rejects only the literal `false`, so the
string `"false"` — legal in untyped JavaScript and in JSON — advertised a date
the read then refused, and the widget failed on every load with nothing naming
the cause.
