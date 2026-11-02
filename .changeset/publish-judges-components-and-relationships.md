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

Publishing a collection entry now judges its field-group (component) values
and its many-to-many relationships as they are stored. Neither sits on the
entry's row, so a status-only publish (a first publication, a republish after
an unpublish, a collection without drafts, a bulk publish, or publishing every
language at once) used to judge the entry without them: a required component
with no instance, or a required many-to-many relationship with no links, went
live unchecked. It now refuses the publish with a validation error on that
field, and the same refusal stops a scheduled release that holds the entry,
naming the entry and the field. The request's own values count, so a publish
that sends the missing value goes live. On a localized collection a required
component is enforced for the default language only, as a translated field's
`required` is. A bulk publish and a release's readiness read every entry's
components and relationships together, one read per field, not one per entry.

Compatibility: custom `validate` functions on top-level component and
many-to-many fields now also run when an entry is published, with the stored
value. An entry missing a value such a field requires, or holding one its
validator refuses as published, can no longer be published until the field is
fixed.
This lifts the limit an earlier release noted, that a required component or
relationship missing from storage was not re-checked at publish.
