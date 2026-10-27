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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

A fractional value written to a whole-number field was decided by the
database. The same write of 2.5 into a default `number` field stored 3 on
MySQL (the fraction lost with no error), answered a 500 on PostgreSQL, and
stored 2.5 on SQLite — one write, three outcomes, one of them silent data
loss. Nothing on the write path asked the field what it stores, so the column
decided alone.

The entry write validation now states the rule: a number field that stores an
integer column refuses a fractional value with a validation error naming the
field, before any row is written, identically on every dialect. Every
persistence path funnels through that one validator, so the refusal covers the
full inventory — create, update, bulk (create and update), restore (a restore
is an update whose patch carries the restored snapshot), the publish-side
validation, the Direct API, plugin services, imports and seeds, which all
write through the same service — and the REST surface and admin forms ride
the same gate. A whole number is accepted exactly as before. A `hasMany`
number stores a JSON list, but the rule follows the field's whole-number
semantics, not the physical column, so a fractional list element is refused
the same way, with the element's position in the issue's path.

Fields that declare decimals keep accepting fractions: a `dbType: "decimal"`
field and a float-format field (the UI's decimal format) are read through the
same opt-ins the storage descriptor reads, so validation and the column
always answer a field the same way. A caller who was silently losing
fractions on MySQL now gets a 400 naming the field — the refusal is the fix,
not a regression. The published-surface shape does not change.

Stored values are untouched. A legacy fractional row — SQLite holds 2.5
where a pre-fix write put it, and the integer columns on MySQL and
PostgreSQL had already rounded the literal at insert — reads and publishes
unchanged: the rule binds values a caller writes, so the publish-side
judgments that re-read stored content (a go-live merge of the stored row
with the caller's patch, a promoted working draft, the per-language go-live
document, a Single's promotion) skip the rule; every value the caller
carried was already judged, and refused, at its own patch gate on the way
in.

Bulk accounting named no field: a returned failure recorded the envelope's
"Validation failed." alone, and a thrown one recorded it too. The per-field
issues are appended on both paths now, so a batch result names the field to
fix.

The number field's own documentation said integer mode "truncates"; it
refuses, and the docs now say so. The admin's number input already offers
whole steps by default (`step` defaults to 1), so no input change was
needed.
