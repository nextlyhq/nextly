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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Make the admin search field an `Input` rather than a second implementation of one.

`SearchBar` restated Input's classes instead of composing it, and the copy had drifted twelve ways: no `aria-invalid` or `data-[invalid=true]` handling at all, so a search field could not show an error state; `focus:border-primary` without the `!` Input uses; and no `selection:*` colours, `placeholder:opacity-50` or `disabled:pointer-events-none`. Palette work reached every input except this one, because the border token was named in two places and only one was maintained.

The field is also `type="search"` now, so assistive technology announces it as one.

Its `className` reaches the wrapper, not the field, so the `border-input` and `border-border` classes eighteen call sites passed were inert. Those are removed and a check keeps them from returning.
