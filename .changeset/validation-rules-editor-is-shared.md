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

Validation rules are now edited the same way everywhere, and a plugin's own
field types finally get them.

The schema builder and the form builder each drew their own validation editor.
They had drifted: different labels, different help text, and different ideas
about which rules a field even accepts. The form builder decided that by
listing type names — text and textarea get length limits, number gets min and
max — which meant a field type contributed by a plugin matched none of the
names and was offered no validation at all. Both now ask the same question of
the same place, so a plugin's field type is offered exactly what its storage
entitles it to.

Fields that exist only inside a form — URL, phone, time and hidden — were also
being offered almost nothing, because they are not part of the core field list
that answers this question. They store text, so they now get the rules text
gets. A URL field with no pattern option was the most obvious casualty.

The form builder no longer offers a rule it cannot enforce. It previously
described a set of rules that did not quite match what its own validator
checks, and a limit that is stored but never applied is worse than no limit at
all: the author believes the form is guarded when it is not.

Plugin authors can build the same editor into their own admin pages —
`ValidationRulesEditor` is published through `@nextlyhq/plugin-sdk/admin`,
alongside the controls published in the previous release.
