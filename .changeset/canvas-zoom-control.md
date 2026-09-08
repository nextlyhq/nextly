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

The canvas says how large it is drawing, and lets you choose.

The editor has always scaled the page to fit whatever room the panels left, so opening a panel shrank it — from 89% to 59.5% — with nothing on screen naming either number and no way to set one. An author judging type or spacing was doing it at a size they had not chosen and could not read.

The percentage is now always shown, including while fitting, because that is the state the editor spends most of its time in. Choosing a size instead makes it stay put: the page stops resizing when panels open, and the canvas scrolls rather than shrinking. Fit is still the default, sits in the same menu as the sizes, and is how you get back.

Magnification is new. The old scale could only ever shrink, so there was no way to look closely at anything.

The choice is remembered per browser, like the other editor preferences, and a stored value that is not a usable size is ignored rather than painting the canvas somewhere the control cannot be reached.
