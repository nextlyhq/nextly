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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

Every access rule is told the languages it judges.

A collection's, a Single's and a field's rule now get `locale`, the one
language the operation is in, and `locales`, every language it involves:

- a read or a write in one language gets that language, an unknown or
  missing `?locale=` being judged as the default it resolves to; a read's
  `locales` also lists each language a missing value falls back to, in the
  order it tries them; a bulk or transactional create or update writes the
  default language, and gets it; a duplicate gets the default language and
  each it falls back to, since it copies what a read of the source shows;
- a read that also reads each language's translation state
  (`?translation-status=1`, or a `_translated` filter) gets every configured
  language, keeping its own as `locale`, and so does an autosave, or a
  working-draft discard, naming a language the site does not configure; a
  bulk update by query, whose filter may choose rows by any language, gets
  every configured language too;
- a read of every translation (`locale=all`), a write to every language
  (`locale=*`), and an operation on the whole entry (a delete, a bulk
  delete, publishing or unpublishing every language, a release)
  get every configured language, with no single `locale`;
- content a collection or Single stores the same in every language (it is
  not localized and has no localized field group) gets every configured
  language, with no single `locale`, whatever `?locale=` names;
- a site with no languages gets none.

So a rule can answer by language, such as
`update: ({ locales }) => !locales.includes("fr")`, and a rule that limits
someone to some languages refuses an operation that reaches beyond them.
Write language rules as restrictions like that one, not as admissions by
inclusion (`locales.includes("fr")`): where the languages an operation
involves can't be known exactly, such as an operation that names none or a
collection built in the admin, the rule is told every configured language,
which a restriction refuses and an admission would allow.

The REST route gate is told the same languages as the service gate, from the
request's `?locale=` for an operation on one language's content (a history
list filtered to one language among them), the default for a bulk write, and
every language for any other. It reads them from the parameters the request
is dispatched with, so a language named twice is judged as dispatched.

A collection preview link names no language, so minting or opening one asks
the read rule in every language: a collection whose read rule closes any
language can't mint entry previews until the preview path binds the link's
language.

A rule that does not read `locale` or `locales` answers as before. Code that
builds a rule's context by hand, such as a unit test of a rule, now gives
`locales` too: `[]` where the site has no languages.
