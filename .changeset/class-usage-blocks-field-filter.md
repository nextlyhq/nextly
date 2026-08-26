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

The class-usage index now finds the blocks fields it is responsible for by reading a
collection's LIVE configuration, so a collection created after the plugin was wired - or a
blocks field added to an existing one - is tracked rather than missed.

A blocks field inside a PRESENTATIONAL group is found. A group without a name stores nothing
of its own and its children live at the parent path, so such a field is reached the same way
a top-level one is; skipping it would leave that document's classes out of the index
entirely, and a class the page still renders would then read as unused. A NAMED group and a
repeater stay excluded, because their children are reachable only through a path the rebuild
cannot resolve - indexing those would write rows nothing could ever reconcile or sweep.

Configuration is read defensively, because it arrives as whatever the host wrote, including
from untyped JavaScript and the Schema Builder's stored JSON. A localized flag is read as a
strict boolean, so a stored string does not file one document's classes under every language.
A field with no usable name is skipped rather than defaulted, since the name is the column
every row is keyed by. A duplicate name yields one subject rather than two.
