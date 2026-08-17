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

Declare the admin's session-free routes once.

Which routes are reachable without a session was answered in three places: the
page registry, a hand-kept set in the refresh interceptor, and the
`pages/(auth)/` directory. A page added to the registry but missed in the
interceptor still rendered, but its expected 401 redirected to login and
discarded the URL, which is how an invite token was once lost.

`PUBLIC_ROUTE_PATHS` in `constants/routes.ts` is now the declaration. The
registry keys its public pages by that type, so the two cannot disagree without
failing the build, and the interceptor derives its set from the same array. A
test reads the `(auth)` directory, which no type can reach, and fails on a page
nobody declared. No behaviour changes.
