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

A `defaultValue` written as a function now works on a reusable field group's children. A field group's fields are read from its stored definition on every write, and a function does not survive being stored, so only constants applied there: a function default on a field-group child was silently dropped on every write. Field groups now get the same live-config capture collections and Singles have, so the function form resolves from the config at boot, and it is re-read when the dev server reloads the config. It resolves against the instance being built, so a child may compute from a sibling defaulted before it.

Only the default is wired. The same capture holds a field's `access` rules, hooks and `validate`, and nothing reads those for a field group, so registering them changes nothing about whether they are enforced.

The promote gate judges the draft the write actually commits.

The gate that re-judges a Single's pending change before it is published ran before the write transaction, where it could only judge a copy of the world as it was. It now runs inside that transaction, on the draft the transaction has locked, which closes what a pre-flight check could not: a draft saved by another writer between the check and the commit is now the draft that is judged; a `beforeChange` hook that turns a status-less edit into a publish no longer slips past a check that ran before the hooks; and `publishAllLocales`, which applies every language's snapshot to one row, now judges the combined result rather than each language against its own shared values. Resolving the caller's grants is the one thing that cannot happen inside a transaction, since it queries the pooled connection that transaction holds, so it is resolved beforehand and handed in.

A field rule on a child of a group or a repeater row is enforced. The check copied the snapshot shallowly, so the rules deleted a denied nested value from the copy and the original alike and the comparison then saw an unchanged container. A denied child is now found at its own depth and named at its own path.

A publish is no longer refused over a field nobody touched. The comparison read the live document through a read that expands an upload or a relationship into the document behind it, while the snapshot holds the identifier, so an untouched field of either kind looked like an edit. Both sides now go through one conversion.

A draft older than a newly required field is refused rather than published. The check judged the promoted document as a patch, which skips absent properties by design, so a snapshot written before a field became required reported nothing and published a document that violates the contract.

An API key is judged on the grants stamped on the key, not on the database roles of whoever owns it.
