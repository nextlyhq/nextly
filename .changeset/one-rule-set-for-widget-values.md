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

The two channels into the widget registry now agree where they should, and
differ only where a plugin's version says they must.

`registerWidget` and `contributes.admin.widgets` had been validating the same
field values with two rule sets, and four fields came apart one at a time. The
shared half is now one rule both ask.

The shared half is deliberately narrow. A contribution crosses a VERSION
boundary -- a plugin may be built against a newer core -- so a closed-vocabulary
check applied there aborts a whole plugin install the moment that plugin names a
size, height or chrome value this core has not learned yet. The admin already
survives those by falling back. Vocabulary checks are therefore the registry's
alone, and only version-independent rules are shared: a shortcut missing its
label or href, a non-finite order, a query that is not an object, and a
placement rule that runs only for archetypes this core recognises.

One rule moved the other way: the registry accepted a truthy non-object `query`
that the contributions gate refused, so it now refuses one too.

A divergence test records the whole relationship -- the rules both channels must
agree on, and every difference that is deliberate, each with the reason it is
not drift.
