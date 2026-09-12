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
"@nextlyhq/plugin-mcp": patch
---

A function default cannot read a field the caller may not write. A `defaultValue` written as a function receives the data built so far, and that data still held every value the caller sent, including one a field rule denies them, so a default could read the forbidden value and carry it into a field the caller IS allowed to write: the denied field was stripped and its value persisted anyway, one column across. The rules are now applied to a COPY, and the copy is what the functions read. The record itself is left alone until the pass that decides what is stored, because a rule may depend on a sibling the caller omitted precisely BECAUSE it has a default, and judging that rule before the defaults exist would deny it and lose the value for good.

A config reload installs the live config's field functions, replacing them wholesale at the point the reload commits. Replacing rather than adding, so an entity the new config no longer declares stops deciding anything: a collection dropped from the config keeps its registry row and its table so an orphan sweep can find them, so it stays addressable. At the commit point rather than when the config is read, so a reload whose DDL succeeds and whose later sync fails does not leave a rule from a config the process refused deciding writes. The field-level registry holds every field's `access` rules, hooks, `validate` and function `defaultValue`, none of which survive being stored, and a reload never went back through service registration: an edit to any of them kept running the version from process start until the dev server was restarted. That is wrong in the direction that matters most for an access rule, since a rule tightened in the config was not the one being enforced. Applied on the same optimistic terms as the field-type registry, and restored by the same undo when a reload is abandoned.

An access rule declared inside an unnamed container is captured. The registry keyed only named entries, so every rule, hook and validator inside an unnamed presentational group was dropped. `defineCollection` refuses a field with no name, but a plugin contributing raw config is checked on its field TYPES and not their names, so the shape reaches the live config.

A Single's first read no longer invents an incomplete group. Filling a group for the sake of one defaulted child, while a required sibling has no default and no value, stored a document the next create or update would refuse; that insert runs no validation pass of its own. The group is left absent instead.

The documentation no longer claims a field group's children take their defaults before the entry's hooks. They are written in their own pass afterwards, so the parent's hooks see such a child as absent.
