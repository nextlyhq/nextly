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

The page builder's op vocabulary is now importable without React, from
`@nextlyhq/builder/ops`.

An op is a change to a document rather than a gesture in a React tree: a server
action that promotes a selection to a component, and an agent asked to insert a
section, apply the same ops the canvas applies. Published only from the package
root, those callers had two options and both were wrong — pull a client
boundary into a server module, or grow a second implementation that agrees with
this one until the day it does not.

The subpath is built by the same server-safe configuration that already
publishes `./geometry` and `./shell-state`, so it carries no `"use client"`
banner and a Server Component can load it. Nothing that already imports these
names from the package root has changed.
