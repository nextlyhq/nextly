---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
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
"@nextlyhq/plugin-commerce": patch
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

Email templates now render with Liquid (LiquidJS), so a template can loop over
a list, branch on a value, and format text, numbers and dates with filters.
Today's `{{variable}}` and `{{a.b}}` are Liquid, and every existing template
renders exactly as before.

Escaping is not up to the template author. Every value written into HTML is
escaped as before; no filter that skips escaping is available, and the tags
that would write a value unescaped (`echo`, `liquid`, `cycle`) or load a file
(`include`, `render`, `layout`, `block`) are refused. HTML is written as it is
only when code marks it with `markHtml()`, exported from `nextly` with
`TrustedHtml` and `EmailTemplateData` (experimental). Only code marks HTML,
and only markup it built itself: never a value from a request, a form, a
stored row or another plugin. Nothing parsed from JSON or a stored row can
carry the mark. A render is limited in
template size, time and memory, and stops with an error naming the limit. A
subject has its line breaks removed.

A stored template that holds text the previous engine sent as written, and
Liquid would read differently (a `{% … %}`, a filter, `{{0}}`, or text Liquid
cannot parse), keeps the previous rendering. It is recorded at the first boot
on this version and stays that way, through edits to its other fields, until
its flagged text is changed and it is confirmed as Liquid.

Saving a template Liquid cannot read is refused, naming the field and the line.
A send whose stored template cannot be rendered fails before any provider is
called, and is not retryable.

The Direct API's `sendWithTemplate` variables and `preview` data accept any
value, lists and objects included, where they were typed as strings.
