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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The CLI now reads the same environment files as the Next.js app in the folder
it runs in, through Next.js's own loader: `.env`, `.env.local`, `.env.<mode>`
and `.env.<mode>.local`, in Next.js's order, with a variable already set in the
process environment winning over every file. It used to read `.env` alone.

The mode is the new global `--mode development|production|test`, else
`NODE_ENV` (`production` or `test`), else development, unset included. The run
sets `NODE_ENV` to it before loading the configuration, so a configuration that
branches on `NODE_ENV` declares the same schema under
`nextly migrate --mode production` as `next build` evaluates. A command that
reaches the database prints the mode and the file its `DATABASE_URL` came from
on standard error, once (none under `--quiet`).

A project's `build` script runs `nextly migrate` before `next build` with no
mode, so with `NODE_ENV` unset that step runs in development mode. Add
`--mode production` to its `nextly migrate` and `nextly plugins install` steps
so they read the production files and evaluate the configuration as
`next build` does. In production mode the environment check asks for
`NEXTLY_SECRET` and `NEXT_PUBLIC_APP_URL`, as the app itself does at build
time.
