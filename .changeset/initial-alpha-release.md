---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/plugin-form-builder": patch
---

Initial alpha release of Nextly — a TypeScript-first, Next.js-native CMS and app framework.

All 12 packages publish at `0.0.2-alpha.0` in lockstep under the `alpha` dist-tag.

**Highlights:**

- **Core (`nextly`)** — REST + Direct API, RBAC, hooks, and the runtime engine. API key prefix is `nx_live_`.
- **Admin (`@nextlyhq/admin`)** — Full-featured admin dashboard.
- **UI (`@nextlyhq/ui`)** — Headless component primitives shared across packages and plugins.
- **CLI (`create-nextly-app`)** — Project scaffolder with blog and blank templates, multi-DB picker, telemetry opt-out.
- **Database adapters** — `@nextlyhq/adapter-postgres`, `@nextlyhq/adapter-mysql`, `@nextlyhq/adapter-sqlite`, plus the shared `@nextlyhq/adapter-drizzle` base.
- **Storage adapters** — `@nextlyhq/storage-s3` (also R2 / MinIO / B2 / Wasabi), `@nextlyhq/storage-vercel-blob`, `@nextlyhq/storage-uploadthing`.
- **Plugins (preview)** — `@nextlyhq/plugin-form-builder` for early exploration; public plugin APIs stabilize at the beta release.

**Alpha caveats:** APIs may change before `1.0`. Pin exact versions in production.

**Install:**

```bash
pnpm create nextly-app@alpha my-app
# or
npx create-nextly-app@alpha my-app
```
