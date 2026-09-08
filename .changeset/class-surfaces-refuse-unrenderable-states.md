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
"create-nextly-app": patch
"nextly": patch
---

The class surfaces now refuse the states the engine cannot render, rather than
recording them and drawing them as done.

An element that already carries as many classes as a page applies refuses both
applying and creating, and one that stores more than that says so — those extra
references style nothing, and removing a class could previously bring one into
use with no explanation. A name is refused once the library is full, because
such a class emits no rule and cannot be saved at all.

The list of classes to add is bounded and says how many it withheld, so a long
library narrows by typing instead of putting thousands of rows in front of an
author. Its rows leave the keyboard where the ARIA combobox pattern puts it —
in the field, with the highlighted row named to assistive technology — instead
of taking every row into the tab order.

Renaming a class to the name it already has no longer reports an edit, so a
document is not revised into a version that renders identically.
