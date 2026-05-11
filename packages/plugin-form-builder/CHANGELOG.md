# @nextlyhq/plugin-form-builder

## 0.0.2-alpha.1

### Patch Changes

- [#13](https://github.com/nextlyhq/nextly/pull/13) [`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Iterative alpha bump: clean stale @nextly/ in adapter descriptions; contributor bootstrap fix; first OIDC-published release.

- Updated dependencies [[`098d5b1`](https://github.com/nextlyhq/nextly/commit/098d5b156a933a1fcb9dc097009d38b05eb43ad8)]:
  - @nextlyhq/admin@0.0.2-alpha.1
  - nextly@0.0.2-alpha.1
  - @nextlyhq/ui@0.0.2-alpha.1

## 0.0.2-alpha.0

### Patch Changes

- [#4](https://github.com/nextlyhq/nextly/pull/4) [`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - Initial alpha release of Nextly — a TypeScript-first, Next.js-native CMS and app framework.

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

- Updated dependencies [[`de96251`](https://github.com/nextlyhq/nextly/commit/de96251483574671e5fe14aa4c1e2c7cf835b67e)]:
  - nextly@0.0.2-alpha.0
  - @nextlyhq/admin@0.0.2-alpha.0
  - @nextlyhq/ui@0.0.2-alpha.0
