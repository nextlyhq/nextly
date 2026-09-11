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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

A dashboard widget can now ask how many rows fall in each interval of a recent
window, ready for a trend line. `nextly.timeseries({ collection, dateField,
interval })` buckets by hour, day, ISO week, month or year, and the `timeseries`
widget op reaches it.

A timeline is a grouped read whose key is a bucketing expression over a date
rather than a second aggregation path, so it settles which rows a caller may
read through the same pipeline a count and a bucket set use. One expression is
built per dialect and used in the SELECT and the GROUP BY alike, which is what
MySQL's `only_full_group_by` requires, and all three databases answer the same
text for the same instant.

An interval with no rows comes back as zero rather than being left out: a
`GROUP BY` cannot report a bucket it never grouped, and a line drawn through the
gap reads as steady activity rather than none. Buckets are computed in UTC, so
the same row lands in the same interval whoever is looking, and the window
bounds the read itself rather than only the answer.

Grouping by a decimal field now labels its buckets to the scale the field
declares. SQLite reads a numeric column back as a JavaScript number while
PostgreSQL and MySQL return text, so the same stored value used to arrive as
`1` on one adapter and `1.00` on the others.

`nextly.group` and `nextly.timeseries` are now documented, including that text
buckets follow the database's own collation — grouping and filtering therefore
agree with each other on every install.
