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

A text widget's markdown and the dashboard's workspace payload close four gaps.

A link written as a path that a browser would read as another site --
`/\example.com`, `https:example.com` -- is left on screen as the markdown it
was written in, instead of becoming a link that leaves the admin in the same
tab. A numeric character reference past Unicode's range now draws as the
replacement character however it is escaped (`&\#1114112;`,
`&#1114112\;`), and a card whose markdown the editor cannot convert for any
other reason is drawn as the text it was written in rather than left blank.

The admin reads its workspace payload again whenever the dashboard layout
reports a different widget audience from the one the payload was built for,
including on the first dashboard visit after a permission change, where a
payload cached beforehand used to be kept. The layout read reports the token
as `audience` and the workspace payload as `widgetAudience`: one token for
one reader. The workspace payload also ships exactly the generated card
definitions its permission decision was taken on, even when a concurrent
request refreshes them in between.
