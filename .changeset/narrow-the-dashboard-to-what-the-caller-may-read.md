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

The admin dashboard now shows only what the signed-in caller is permitted to
read. Previously a caller holding NO read permissions was treated as having no
filter at all, so the least-privileged account saw every collection; the
activity feed applied no permission filter of any kind; and recent entries were
read with hand-built SQL that bypassed access control entirely.

Operators should expect restricted users to report an EMPTIER dashboard than
before, and that is the fix rather than a regression. A user without read
permission on a collection no longer sees its entry count, its draft/published
breakdown, its recently-edited entries, or its activity-feed rows — including
the entry titles, author names and author emails those rows carry. The
"changes in the last 24 hours" figure is now counted over the same permitted
collections instead of over every collection.

API keys are judged on their OWN stamped grant rather than on the roles of
whoever minted them. A deliberately narrowed key issued by a super-admin
previously inherited that super-admin's reach on the dashboard endpoints; it
now sees only the collections it was actually granted.

What a caller may read is now decided by the ACCESS LAYER rather than inferred
from the permission table's rows. A collection whose `access.read` rule refuses
the caller is excluded even when a permission row would have admitted it — the
dashboard now agrees with what `GET /api/collections/{slug}` answers. A
collection authorized entirely in code, with no permission row at all, is
included for the same reason. Per-collection entry counts are read with access
enforced, so a collection with an owner-only or custom read rule now reports the
number of rows the caller may actually see rather than every row in the table.

Two behaviour changes are worth planning for:

- A super-admin's activity feed is now bounded by the collections and settings
  resources that currently exist. Activity rows naming a collection that has
  since been removed from the config are no longer listed, and no longer
  counted in the 24-hour figure.
- A recently-edited entry whose title field holds a structured value (a `json`,
  `group`, `repeater`, `component` or `chips` field named by
  `admin.useAsTitle`) is now labelled with its id instead of rendering as
  `[object Object]`. An empty, boolean or date-valued title field falls through
  to the next candidate field and then to the id, where before it rendered as an
  empty or nonsensical heading.
- The draft/published breakdown on `/stats` is now read through the same
  access-enforced count as the per-collection totals beside it, instead of a
  raw query over the whole table. A collection with an owner-only or custom
  stored read rule previously reported every author's draft/published split to
  every reader who could open it at all, and that number disagreed with
  `content.totalEntries` sitting next to it in the same response; the two now
  always agree (`totalEntries === status.published + status.draft`). This also
  fixes the breakdown never actually running for a collection with the
  Draft/Published lifecycle enabled: it identified such a collection by
  scanning its fields for one literally named `status`, but a field with that
  name is REJECTED by config validation while the lifecycle is on, so every
  lifecycle collection was silently treated as having no status at all.

One failure mode is deliberately visible as an empty dashboard: if the
permission lookup itself fails transiently, the dashboard answers HTTP 200 with
nothing in it rather than falling back to showing everything. An empty
dashboard that should not be empty is worth investigating in the server logs.

For anyone calling the Direct API: `nextly.count()` accepts a `status` option
(`"published" | "draft" | "all"`), matching `nextly.find()`. Its absence is
unchanged — an access-enforced count still defaults to published-only on a
collection with the draft/publish lifecycle — but a caller that wants the same
rows a `find({ status: "all" })` would return can now ask for them, and the two
totals agree.
