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

The email template editor now gets the window.

Editing a template used to leave roughly half the screen to navigation: the
settings menu stayed open beside a fixed panel of variables and settings, and
the code and the preview shared what was left. On a 1280px screen that was
316px each — too narrow to read a line of the template or to see the email at
its real width.

The settings menu now steps aside while you edit, and the two panes you are
actually working in take the space, with a handle between them so you can give
whichever one you need more room. Everything that addresses the mail — From,
Reply-to, Subject and the preheader — sits together at the top instead of being
split between the editor and a settings tab, and the variables you insert are
beside the cursor rather than a panel away. Settings open over the preview when
you want them and leave the code where it was.
