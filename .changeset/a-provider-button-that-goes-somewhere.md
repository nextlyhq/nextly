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

A login provider button can now carry an `href`, and the login page renders it
as a link. Previously a provider that did not ship its own React component
rendered a button with no handler behind it: it looked like a way to sign in
and did nothing, so only providers shipping a component could start a flow.

The path is validated where it is served: exactly one leading slash and a
second character that cannot begin an authority, which rejects absolute URLs,
protocol-relative paths and the backslash forms. A login button is the most
valuable place on a site to plant an open redirect. It is deliberately not
required to sit under `/admin/api`, because that base path is configurable and
a plugin may mount its routes at the root.

Plugin-contributed login slots also render where their names say. Everything
was previously rendered below the form, which made `beforeForm` describe
nothing and put provider buttons underneath the password field they are an
alternative to.
