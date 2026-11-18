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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

`nextly upgrade [version]` now upgrades Nextly: it moves `nextly` and every `@nextlyhq/*` package a project declares to one release, with the project's own package manager (npm, pnpm, Yarn with `node_modules`, or bun).

- With no version it follows the channel of the installed release: the npm dist-tag its prerelease identifier names (`alpha` for `0.0.2-alpha.68`), or `latest`. It never moves to another tag's release or to an older one. On the channel's newest release it changes nothing, exits 0, and names any other tag holding a newer release. Where the channel has no tag or `nextly` is not installed, and for a version that is not published, it changes nothing and exits 1 with `UPGRADE_RELEASE_UNKNOWN`, naming the release it would choose or every tag with its release.
- It writes the one exact version for every package into `package.json` and runs the package manager's install. Before that it checks every package has the release (`UPGRADE_PACKAGE_CANNOT_MOVE`).
- If the install fails, `package.json` and the lockfile are put back byte for byte, the packages are installed from them again, and each is read back at the version it had (`UPGRADE_INSTALL_FAILED`). Where they cannot be put back it says which and what to run (`UPGRADE_NOT_RESTORED`).
- After a move it prints the release notes link and what to run next: `nextly migrate:create`, then `nextly migrate`. `--dry-run` lists each package's move and changes nothing.

**Compatibility.** `nextly upgrade --reconcile-core` is gone: `nextly migrate` already brings Nextly's own tables up to date. That flag and the others of the command's earlier database work (`--confirm-backed-up`, `-f`/`--force`, `--target-table-name`, `--force-unlock`, `--accept-data-loss`) still parse, change nothing (no package, no file, no table) and exit 1 with `UPGRADE_WORK_MOVED`, naming `nextly migrate`. A bare `nextly upgrade`, which exited 1 with that code in the last release, now upgrades the packages. Yarn Plug'n'Play is refused for now (`UPGRADE_CANNOT_START`).
