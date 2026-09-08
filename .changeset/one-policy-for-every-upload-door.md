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

An installation's upload policy applied to one entry point and not the other.
The published server action reaches the legacy media service, which never runs
the configured validator, so that path enforced no allowlist, no magic-byte
comparison and no sanitisation while the mounted REST handler enforced all
three. A deployment excluding a format through `security.uploads` had the
setting silently ignored on the action, and what lands there is retrievable
through the anonymous byte route. The action now builds the validator from the
same config and refuses before anything is stored.

A file's type is also inferred from its name for every accepted format rather
than for fonts alone. The media dropzone offers each of them by suffix, and a
browser reports no type at all for whatever its platform does not register — so
a file the browser accepted was refused by the server for carrying no type.
Fonts still answer to their own signature, because the sniffer recognises
neither WOFF nor WOFF2; every other inferred type meets the magic-byte
comparison.

A configured allowlist naming a font by its legacy spelling never met an
upload's canonicalised claim, so a full override advertised a format it then
refused. Allowlist entries canonicalise through the same table.
