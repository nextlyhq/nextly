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

Validation rules are now edited the same way everywhere, and the form builder
stops offering rules it cannot enforce.

The schema builder and the form builder each drew their own validation editor.
They had drifted: different labels, different help text, and different ideas
about which rules a field even accepts. The form builder decided that by
listing type names — text and textarea get length limits, number gets min and
max — so a field type it had not been written to know about matched none of the
names. Both surfaces now ask the same question of the same place.

Fields that exist only inside a form — URL, phone, time and hidden — were being
offered almost nothing, because they are not part of the core field list that
answers this question. They store text, so they are now understood as text. A
URL field with no pattern option was the most obvious casualty.

The form builder now offers each field type exactly the rules its own validator
reads back for that type, which is narrower than it sounds and is the point. A
date accepts minimum and maximum values, and the form's validator reads those
from a different place — so offering them here would store a bound nothing
consults. The same was true of length limits on email, phone and URL fields, a
pattern on a textarea, and every rule on time and hidden fields. A limit that is
stored but never applied is worse than no limit at all, because the author
believes the form is guarded when it is not.

The message shown when a value fails no longer says it describes the pattern.
In a form it is used for required, length and format failures too, so copy
written for one rule was appearing for others.

Plugin authors can build the same editor into their own admin pages —
`ValidationRulesEditor` is published through `@nextlyhq/plugin-sdk/admin`,
alongside the controls published in the previous release.
