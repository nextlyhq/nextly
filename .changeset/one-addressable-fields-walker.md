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

The walk that decides which fields a level addresses is published, so a plugin can call it instead of writing its own.

An unnamed group exists to lay fields out: its children are stored at the level the group sits in, not under it. A named group stores its children under itself. Telling those apart is what finds where a value is actually kept, and it was implemented twice — once in core's version tagging, once in the page-builder plugin, because the core one was exported from its module and from no public entry, so a plugin could only reach it by importing core's file layout.

The published one no longer dies on config an author can write. A group that contains itself overflowed the call stack, and a group wider than the engine's argument limit threw out of `push(...children)` — both reached inside a post-commit hook, where a throw reports a failed save for one that actually succeeded. The walk is iterative and carries a cycle guard, so neither is reachable, and a field list that is not a list, an entry that is not an object, and a `fields` that is not an array are answered with what is there rather than an exception.

`addressableFields` is published from `nextly` and re-exported from `@nextlyhq/plugin-sdk` as `@experimental`, recorded in that package's stability ledger. It is AVAILABLE for the page-builder to migrate onto; that plugin still runs its own walk, and moving it is a behavioural change for that index rather than a deletion. It returns the widest union a field can be, because an unnamed group may contain a contributed field and flattening it returns something no built-in union describes — a narrower promise turned a plugin's own field into `never` at the moment its owner tried to recognise it. A caller that must not descend some containers says so with `descendInto`. That choice has to be made during the walk rather than afterwards: the result holds the flattened children themselves, so a field reached through an unnamed repeater — whose values are stored per row — is the same object as one reached through an unnamed group, and no filter over the returned list can separate them. It had no tests anywhere; it has fifteen now, eight of which pin what it already did so the move can be shown to have changed nothing that was working.
