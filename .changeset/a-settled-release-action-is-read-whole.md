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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A release pass now passes over a document already where its action leaves it only on a
consistent and fully authorized reading. The stored status, every translation's status and
the working drafts are read together, in one transaction under the row lock the write takes,
so a publish or takedown landing in between can no longer pair a status with drafts it has
since consumed. The document also counts only when the author's field rules still let them
set its status, as the write requires, and never once its collection or Single has its
draft/published lifecycle turned off. A write the writer refuses (an access or field-rule
refusal) now fails that document without the document being read back, and a write that
committed is confirmed from storage alone, so a role revoked just after it no longer leaves
the release scheduled.
