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

A plugin can now name the locale it reads or writes in. `ServiceOpts` — the
options every `ctx.services.collections` call takes — gains `locale` and
`fallbackLocale`, spelled as the request context and the REST API already
spell them, and both are carried through to the collection services. Until
now the request context could hold the pair and every read accepted it, but
nothing on the plugin path could say it and the facade's forwarding seam
dropped it even when a context did: every plugin read and write on a localized
site was in the default language, silently. A code that is not a configured
locale resolves to the default on a read, as it does on the wire, and is
refused on a write, so a typo cannot overwrite the default language's
content. `createMany` refuses any locale by name rather than filing the rows
under the default language silently; its bulk pipeline cannot store a
translation yet.

The form builder uses it for the one place a visitor could see the gap. A
form that redirects to a picked page read that page with no locale, so a page
whose slug is `thanks` in English and `merci` in French sent every visitor to
`/thanks`. `submitForm` takes `locale`, and the built-in
`POST /api/forms/:slug/submit` reads it from `?locale=` — the same place
core's own routes take a locale — so a French submission is answered with the
French URL, and one that names no language is answered as before. The target
is read as the visitor rather than as the system, so a translation still in
draft is never the URL a visitor is sent to; the published default answers
until it is published. The read wildcards (`all`, `*`) are not a language and
read as none.
