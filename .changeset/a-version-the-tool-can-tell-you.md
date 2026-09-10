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

`nextly --version` reports the version that shipped.

The constant behind it was typed by hand under a comment saying it "should
match package.json version". It did not: the CLI answered `0.1.0` while the
package shipped `0.0.2-alpha.65`, so anyone asking the tool which Nextly they
were working against got a confident wrong answer — and telemetry attributed
every CLI event to a version that has never been published.

It is asked of the same resolver the plugin system already uses to validate a
plugin's `nextly` compatibility range, so a reported version and a
compatibility answer can no longer disagree. A test holds the two together.

The scaffolded agent guide now says how to find that version and where the
authoritative documentation is, including the two machine-readable indexes at
`/llms.txt` and `/llms-full.txt`. An agent working in a Nextly project would
otherwise answer from whatever it remembers of some other version.
