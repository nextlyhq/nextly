---
"@nextlyhq/eslint-plugin": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

`get_initial_context`: the first thing an agent should ask a Nextly install.

An agent arriving at an unfamiliar CMS knows the protocol and nothing about the
install, and without this it discovers the shape by trial, spending a request
per guess. One call now answers what it can work with and how this CMS expects
to be asked. The tool name follows the convention other CMS servers have settled
on, so a client looking for it finds it where it looks.

The answer is scoped to the caller. It lists the collections and singles that
caller may read, taken from core's own access decision rather than from the
registry, so a key scoped to one corner of an install does not learn the shape
of the rest. It also reports whether the list is the WHOLE answer: describing an
install is a positive claim, and a registry that could not be enumerated would
otherwise be reported as an install with no content.

The instructions and the data do not mix, and that is a security property rather
than a style. A tool result is text the model reads, and a model cannot reliably
tell an instruction the server wrote from one that arrived inside a value. The
instructions are a constant, and the schema travels beside them as structured
content, so a collection an attacker can name cannot reach the sentence that
tells the agent how to behave.

`readableContent` is published from core and re-exported by
`@nextlyhq/plugin-sdk`, because a plugin that describes an install needs the
coarse readable set and composing it from the registry, the caller conversion
and the per-entity decision is exactly where the dashboard's own version once
went wrong: it derived the set by filtering permission slugs, which disclosed a
refused collection on one surface while hiding a code-authorized one on another.
