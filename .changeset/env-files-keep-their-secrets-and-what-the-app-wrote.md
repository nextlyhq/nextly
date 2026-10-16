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

The env files `create-nextly-app` writes no longer leak the secret, and no longer replace what an app already has.

- `.env.example`, which a template project commits, now carries an empty `NEXTLY_SECRET` and the database's generic example URL. It used to carry the same secret as `.env`, and a database URL typed during setup, password included. An empty secret is refused in production, so a copied example cannot run a deployment. The base template's own example file had a 34-character placeholder, long enough to pass that check, and an unfilled `{{storageEnvVars}}` line; both are gone.
- An existing `.env` or `.env.example` is never replaced. Every line stays, and only the keys Nextly needs that the file lacks are added, under a marked block. An existing `.env` that had `DATABASE_URL` used to get nothing at all, so production answered 500 for the missing secret. Which keys a file has is read line by line, so `export KEY=`, quoted values, a key named only in a comment and a similarly named variable are told apart.
- When a file is already set up for another database than the one chosen, neither `DB_DIALECT` nor `DATABASE_URL` is added beside it, and the run says so. Scaffolding over a folder that has files keeps its `.env.example`, which the env step then extends.
- Values are read as Next.js reads them: `$NAME` references expand, and a value that refers to a variable set only where the app runs is not judged. A `DATABASE_URL` that is not a URL is reported.
- `.env` is protected before anything is written. When only this machine's excludes ignore it, or the project re-includes it, it is added to `.gitignore`. A linked `.gitignore` is left as it is, and the run says what to add. When git already tracks `.env`, which `.gitignore` cannot undo, no generated secret or typed database password is written to it, and the run says how to stop tracking it (development runs without the secret).
- A value the app already had and Nextly cannot use, or a real-looking secret or database password in an example file, is left as it is and reported, naming the file and key and never printing the value. The run now lists what it wrote and what it added.

A project made with an earlier version should check whether its `.env.example` was committed holding a real `NEXTLY_SECRET` or database password. If it was, empty them there, and replace the secret and password themselves.
