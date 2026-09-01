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

A widget source now carries the human label of each field it exposes, and a `list` result describes the columns the query selected.

`WidgetSourceField` gains an optional `label`, carried from the field's own config — the same string the entry form puts above it. A widget that draws a TABLE needs a column heading, and the only honest one is the label the field already has. The alternatives are both worse: deriving prose from an identifier guesses at capitalisation and word breaks it cannot know, and asking the widget author to declare headings puts a second answer beside `select`, free to disagree with it.

A `list` result gains `fields`: the selected field names in the order they were selected, each with its label where the source has one. Carried on the RESULT rather than published as source metadata, and that placement is an access-control decision. A widget's source is proven readable before a row is returned and `select` names the fields the caller asked for, so answering with labels for exactly those fields discloses nothing new. A separate metadata channel would be an enumeration surface: the query endpoint is careful that a source the caller may not read answers exactly as one that does not exist, and publishing field lists beside it would undo that.

`fields` is present only when the query declared `select`. Without it the rows carry whatever the collection holds, so there are no columns the widget chose and nothing honest to head them with. A label that is blank or whitespace is omitted rather than passed on, since an empty column head above real data is worse than falling back to the field name.
