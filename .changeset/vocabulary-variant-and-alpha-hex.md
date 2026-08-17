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

Fix two defects in `@nextlyhq/eslint-plugin`'s colour vocabulary.

`no-palette-classes` missed a fixed palette colour placed behind an arbitrary Tailwind variant — `data-[state=open]:bg-red-500`, `supports-[display:grid]:bg-red-500` and the bracket-led `[&>*]:bg-red-500` all reported clean, so a colour that ignores dark mode and retheming passed lint.

`no-hardcoded-colors` rejected the four-digit spelling of the mode-invariant colours it documents as legitimate: `#0000` and `#fff8` were reported as hardcoded, because alpha was only offered on the six-digit forms.
