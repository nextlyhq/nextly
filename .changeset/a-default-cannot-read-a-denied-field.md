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

A function default cannot read a field the caller may not write. Field write access now runs before the defaults as well as after the hooks, the two passes the read path already runs: a `defaultValue` written as a function receives the data built so far, and it ran while a field this caller is denied was still in the record, so a default could read the forbidden value and carry it into a field the caller IS allowed to write. The denied field was stripped and its value was persisted anyway, one column across.

A config reload re-registers the live config's field functions. The field-level registry holds every field's `access` rules, hooks, `validate` and function `defaultValue`, none of which survive being stored, and a reload never went back through service registration: an edit to any of them kept running the version from process start until the dev server was restarted. That is wrong in the direction that matters most for an access rule, since a rule tightened in the config was not the one being enforced. Applied on the same optimistic terms as the field-type registry, and restored by the same undo when a reload is abandoned.

An access rule declared inside an unnamed container is captured. The registry keyed only named entries, so every rule, hook and validator inside an unnamed presentational group was dropped. `defineCollection` refuses a field with no name, but a plugin contributing raw config is checked on its field TYPES and not their names, so the shape reaches the live config.

A Single's first read no longer invents an incomplete group. Filling a group for the sake of one defaulted child, while a required sibling has no default and no value, stored a document the next create or update would refuse; that insert runs no validation pass of its own. The group is left absent instead.

The documentation no longer claims a field group's children take their defaults before the entry's hooks. They are written in their own pass afterwards, so the parent's hooks see such a child as absent.
