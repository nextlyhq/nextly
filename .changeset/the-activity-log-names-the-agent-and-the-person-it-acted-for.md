---
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

The activity log, the audit log and an entry's history can now say that an agent acted for a person: "Claude Code, for Sara Malik, approved on phone". Beside the person, who stays the actor, each record can hold the agent's name and session, how the call arrived (the command line on your own machine, the site's command door, a chat app, the REST API with an agent's key, or a deploy pipeline), the pass, connection or key by id, an approval with who gave it and where, a standing grant, the agent session an undo put back, and a deployment's host and commit, read as "Deployment (Vercel build, commit 3f2a1c9)".

`nextly migrate` adds the new columns to existing databases; records written before them read as they always did. Records hold ids only: a value shaped like a token or a whole API key is refused and the rest of the record is still written. Erasing a person erases them from these records as from their own, and keeps the agent's name.

The dashboard's activity read takes `agent` and `session` to show one agent's or one session's records, and the Team activity card shows an agent's saves as their own row beside the person's.
