---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fix `Cannot find package '@nextlyhq/plugin-form-builder'` on `pnpm dev` for blank scaffolds. The base admin page (`templates/base/src/app/admin/[[...params]]/page.tsx`) and the existing-project admin generator both hard-coded three side-effect imports for `@nextlyhq/plugin-form-builder`, but the package was only added to `package.json` on the fresh-scaffold npm path. Blank scaffolds and existing-project installs got the imports without the dep, so `next dev` failed at module resolution. The plugin is now opt-in per template: blank ships a plugin-less admin page; the blog template overlays a blog-specific admin page that re-adds the imports (mirroring how `formBuilderPlugin` is registered only in the blog config). `generatePackageJson` and the yalc paths in `installDependencies` accept a `projectType` and only include `@nextlyhq/plugin-form-builder` when the selected template uses it.
