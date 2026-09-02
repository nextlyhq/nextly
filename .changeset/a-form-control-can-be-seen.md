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

A form block published to a page rendered as a column of labels with nothing
under them. The fields were there, focusable and submittable, and invisible: a
browser draws a border and a background on an input, a CSS reset takes both
away, and the reset the scaffold ships is one. Its submit had the same problem
from the other direction — a bare button stripped back to plain text, sitting
on the same page as a button block that is a blue rounded control.

Form controls now draw a border, a background and padding of their own, so they
do not depend on the host leaving a browser default alone. The submit wears the
button block's appearance rather than a second description of it, because a
form's submit and a button are one control to the person filling it in.

The colours come from tokens and the spacing does not, which is the split the
card block already states: a literal colour is wrong in whichever of light and
dark it was not chosen for, while a literal length is safe in both.
