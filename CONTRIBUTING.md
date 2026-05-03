# Contributing to Nextly

Thanks for your interest in contributing to Nextly. This guide walks you through reporting issues, proposing features, and submitting pull requests. Whether it's a typo fix or a new database adapter, every contribution helps.

This project and everyone participating in it are governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you're expected to uphold it.

## Where to get help

- **Have a question?** → [GitHub Discussions](https://github.com/nextlyhq/nextly/discussions)
- **Found a bug?** → [Open an issue](https://github.com/nextlyhq/nextly/issues/new/choose) (use the bug template)
- **Want to propose a feature?** → [Start a discussion](https://github.com/nextlyhq/nextly/discussions) or [open a feature request](https://github.com/nextlyhq/nextly/issues/new/choose)
- **Found a security issue?** → See [Reporting security issues](#reporting-security-issues) below — do not open a public issue

## Reporting bugs

Before opening a bug, please:

1. Search [existing issues](https://github.com/nextlyhq/nextly/issues?q=is%3Aissue) to avoid duplicates.
2. Confirm you're on the latest version of the affected package.
3. Use the [Bug Report template](https://github.com/nextlyhq/nextly/issues/new?template=bug_report.yml) — it asks the questions we need to triage quickly.

The single biggest factor in how fast a bug gets fixed is **a minimal reproduction**. Issues without one are likely to be closed. The fastest way to start one: `pnpm create nextly-app@latest`, push the failing scenario to a public repo, and link it in the bug report.

## Reporting security issues

**Do not open public issues for security vulnerabilities.** Please use GitHub's [private security advisory form](https://github.com/nextlyhq/nextly/security/advisories/new) instead. We'll respond as quickly as we can and coordinate disclosure with you.

If you find a vulnerability of significant impact, we'd love to acknowledge your help in the eventual security advisory.

## Feature requests and large changes

Small features and bug fixes can go straight to a PR. For anything larger — new APIs, new packages, breaking changes, schema redesigns — please **start a [Discussion](https://github.com/nextlyhq/nextly/discussions) first**. New functionality often has implications across the monorepo, and it's much faster to align on the approach before writing code than after.

We don't yet have a formal RFC process; significant proposals are discussed in GitHub Discussions until they're ready to become PRs.

---

## Development setup

### Prerequisites

- Node.js >= 18 (Node 22 LTS recommended)
- pnpm >= 9
- Docker Desktop (for the local database during development and integration tests)

### Installation

```bash
git clone https://github.com/nextlyhq/nextly.git
cd nextly
pnpm install

# Start the development loop (no `pnpm build` first — see "Development workflow" below)
pnpm dev
```

### Development workflow

Run `pnpm dev` from the **monorepo root** (not from `apps/playground/`). Turborepo orchestrates every workspace package's `dev` script in parallel, so a single command starts everything. Edits to any package's source flow into the playground without a manual rebuild.

The workspace is intentionally bimodal:

| Side             | Packages                                                           | How they're loaded in dev                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client (browser) | `@revnixhq/ui`, `@revnixhq/admin`, `@revnixhq/plugin-form-builder` | Turbopack reads `src/` directly — see [`apps/playground/next.config.ts`](apps/playground/next.config.ts) `turbopack.resolveAlias`. Edits HMR through immediately. |
| Server (Node)    | `@revnixhq/nextly`, all 4 adapters, all 3 storage packages         | `serverExternalPackages` + each package's `tsup --watch` keeps `dist/` fresh. Edits round-trip through dist (~1–2 s rebuild).                                     |

This split exists because `serverExternalPackages` means Node loads the package via `require()` at runtime; bundler aliases don't apply to that path, so server-side packages need to keep producing dist. Client-side packages have no such constraint and benefit from Turbopack-direct reads.

The admin's CSS pipeline runs alongside under the same `pnpm dev` (in-process Tailwind compile + `.adminapp` scoping post-process; see [`packages/admin/scripts/dev.mjs`](packages/admin/scripts/dev.mjs)). Hot rebuilds are sub-second.

If you only want a subset of watchers running, the targeted scripts still work:

```bash
pnpm dev:core    # only nextly in watch mode
pnpm dev:admin   # only @revnixhq/admin (JS + CSS via scripts/dev.mjs)
pnpm dev:app     # only the playground (no upstream watchers)
```

### When to use `pnpm build`

Not for routine development — `pnpm dev` covers the dev loop. Use `pnpm build` when you need to:

- Verify the production build path before opening a PR (`pnpm build` → 14 turbo tasks)
- Reproduce a `next start` issue against built artifacts
- Prepare a release (the changesets workflow runs build internally)

### Common commands

```bash
# Type check all packages
pnpm check-types

# Run linter
pnpm lint

# Run tests (unit suite by default)
pnpm test
```

For per-package commands, use `pnpm --filter <package-name> <script>`. For example: `pnpm --filter @revnixhq/admin test`.

---

## Monorepo structure

Nextly uses a pnpm + Turborepo monorepo. Key directories:

```
nextly/
├── apps/
│   └── playground/          # Development/testing app
├── packages/
│   ├── nextly/              # Core CMS (@revnixhq/nextly)
│   ├── admin/               # Admin UI (@revnixhq/admin)
│   ├── client/              # Client SDK (@revnixhq/client)
│   ├── ui/                  # Headless components (@revnixhq/ui)
│   ├── adapter-postgres/    # PostgreSQL adapter
│   ├── adapter-mysql/       # MySQL adapter
│   ├── adapter-sqlite/      # SQLite adapter
│   ├── adapter-drizzle/     # Drizzle ORM adapter
│   ├── storage-s3/          # S3-compatible storage
│   ├── storage-vercel-blob/ # Vercel Blob storage
│   ├── storage-uploadthing/ # UploadThing storage
│   ├── plugin-form-builder/ # Form builder plugin
│   ├── create-nextly-app/   # CLI scaffold
│   ├── telemetry/           # Telemetry helper
│   ├── eslint-config/       # Shared ESLint config
│   ├── tsconfig/            # Shared TypeScript config
│   └── prettier-config/     # Shared Prettier config
├── scripts/                 # Monorepo scripts
└── docs/                    # Documentation
```

---

## Testing

Nextly has two test suites split by filename convention:

| Suite       | What it covers                                                                                | Run with                |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| Unit        | Logic that doesn't need a database. Pure functions, mocked services, type guards.             | `pnpm test:unit`        |
| Integration | Anything that hits a real database — adapters, the schema pipeline, query builder edge cases. | `pnpm test:integration` |

Test files declare their suite by filename:

- `*.test.ts` — unit test (no DB)
- `*.integration.test.ts` — integration test (real DB required)

### Running the unit suite

No setup needed:

```bash
pnpm test:unit
```

This skips all `*.integration.test.ts` files. Should pass quickly.

### Running the integration suite

**Step 1:** Boot the test stack

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts:

- PostgreSQL 15 on port 5434 (Nextly's minimum supported version)
- PostgreSQL 17 on port 5435 (current latest)
- PostgreSQL 16 on port 5433 (legacy default; will be removed in v2)
- MySQL 8.0 on port 3307

SQLite is in-memory and needs no service.

**Step 2:** Run integration tests against the dialect of your choice

```bash
# All dialects (matches CI)
pnpm test:integration

# Single dialect (faster local iteration)
pnpm test:integration:postgres15
pnpm test:integration:postgres17
pnpm test:integration:mysql
pnpm test:integration:sqlite
```

Each script sets the appropriate `TEST_<DIALECT>_URL` env var. Tests skip themselves if their dialect's env var is unset.

**Step 3:** Tear down

```bash
docker compose -f docker-compose.test.yml down
```

### Skipping integration tests locally

If you only work on PG paths, you can skip the MySQL job:

```bash
# Boot only Postgres services
docker compose -f docker-compose.test.yml up -d postgres15-test postgres17-test

# Run only the postgres integration jobs
pnpm test:integration:postgres15
pnpm test:integration:postgres17
```

CI will catch any MySQL or SQLite failures on your PR.

### Writing a new integration test

1. Name the file `<basename>.integration.test.ts`. Example: `query-builder.integration.test.ts`.
2. Use the helper:

   ```ts
   import { makeTestContext } from "@revnixhq/nextly/database/__tests__/integration/helpers/test-db";

   const ctx = makeTestContext("postgresql");

   describe("query builder against PG", () => {
     if (!ctx.available) {
       it.skip("TEST_POSTGRES_URL not set; skipping", () => {});
       return;
     }
     // your tests here, using ctx.url for the connection.
     // ctx.prefix gives a unique 8-char hex prefix to stamp on
     // schema/table names so parallel tests don't collide.
   });
   ```

3. Stamp `ctx.prefix` on every schema, database, or table name your test creates.
4. Drop everything you created in `afterAll`.

### Test conventions

- Tests are co-located with source files in `__tests__/` directories
- Test files use `.test.ts` (unit) or `.integration.test.ts` (integration)
- Per-scenario integration tests live under `packages/nextly/src/database/__tests__/integration/`
- pushSchema fixtures live under `packages/nextly/src/database/__tests__/integration/__fixtures__/pushSchema/`
- Test framework: **Vitest**. Each package has `vitest.config.ts` (unit) and `vitest.integration.config.ts` (integration with 30s timeouts + singleFork pool)

### CI test workflows

Two GitHub Actions workflows run on every PR:

- [`ci.yml`](.github/workflows/ci.yml) — lint, typecheck, build, and unit test suite
- [`test-integration.yml`](.github/workflows/test-integration.yml) — the 4-dialect matrix (PG 15, PG 17, MySQL 8, SQLite). Any failure blocks merge.

A PR is mergeable when all jobs are green.

---

## Pre-commit hooks

The following hooks run automatically:

| Hook         | What runs                                                                             |
| ------------ | ------------------------------------------------------------------------------------- |
| `pre-commit` | Prettier formatting + ESLint on staged files (via lint-staged) + gitleaks secret scan |
| `commit-msg` | Validates conventional commit format (see [Commit messages](#commit-messages))        |
| `pre-push`   | Runs the production build to ensure all packages still compile                        |

If a hook fails, fix the issue and re-stage. **Never bypass with `--no-verify`** — the hooks exist to catch problems before CI does.

---

## Branch naming

Use a short, descriptive branch name. The standard format:

```
<type>/<scope>/<short-description>
```

- **type**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci` (matches commit types below)
- **scope**: the package directory name (e.g., `admin`, `adapter-postgres`, `plugin-form-builder`) or `root` for repo-wide changes
- **description**: lowercase, hyphens only, ≤40 characters

Examples:

```
feat/admin/role-manager-dialog
fix/adapter-postgres/connection-pool-leak
chore/root/upgrade-typescript
docs/storage-s3/readme-update
```

Branch names aren't strictly enforced by CI — but consistent names make the merge log readable.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). The `pr-title.yml` workflow enforces this on PR titles, and commitlint validates each commit locally via the `commit-msg` hook.

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Scopes**: see the canonical list in [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml). Match a package directory name (`admin`, `nextly`, `adapter-postgres`, etc.) or use `root`, `deps`, `release`, `ci`, or `docs` for repo-wide changes.

**Description rules**: imperative mood ("add" not "added"), lowercase, no trailing period, ≤72 characters.

Examples:

```
feat(admin): add user authentication with JWT
fix(adapter-postgres): resolve connection pool memory leak
docs(root): update README with launch checklist
chore(deps): bump zod to 4.2.0
```

For breaking changes, add a `BREAKING CHANGE:` footer:

```
feat(nextly): require Postgres 15+ for new install path

BREAKING CHANGE: Postgres 14 is no longer supported. See migration guide for
upgrade steps.
```

To reference issues in the body or footer:

```
Fixes #123
Closes #456
```

These keywords auto-close the linked issue when the PR merges.

---

## Submitting a pull request

1. **Fork** the repo and create a branch off `dev` (not `main` — see [Branch protection](#branch-protection)).
2. **Make your change.** Add or update tests when relevant.
3. **Run locally**: `pnpm lint && pnpm check-types && pnpm test`.
4. **Add a changeset** if your PR touches any publishable package (see [Release process](#release-process) below).
5. **Open the PR against `dev`.** Fill out the [PR template](.github/pull_request_template.md) — it's auto-applied when you open a PR.
6. **Watch CI.** Lint, typecheck, build, unit tests, and the integration matrix all need to be green before merge.

### Reviewer expectations

- At least one maintainer approval is required before merge.
- All conversations resolved.
- All CI checks passing (no `continue-on-error` workarounds).
- Branch up to date with `dev`.

### Merge strategy

- **Squash and merge** — the default for feature branches and bug fixes. PR title becomes the squashed commit message, so make sure it follows Conventional Commits.
- **Rebase and merge** — only for hotfixes that need to preserve individual commits.
- **Merge commit** — used by the release workflow when merging Version Packages PRs.

### Branch protection

`main` and `dev` are protected. Direct pushes are blocked; all changes go through PRs. CI must pass before merge.

---

## Release process

> **Status:** Nextly's release pipeline uses [Changesets](https://github.com/changesets/changesets) for versioning and [`changesets/action`](https://github.com/changesets/action) for the version-PR + publish flow. This is being initialized as part of the v1.0 launch — once `.changeset/config.json` lands in the repo, the steps below describe the steady-state flow.

All publishable `@revnixhq/*` packages are kept in lockstep (same version at all times) via the `fixed` array in `.changeset/config.json` — this matches Payload CMS's unified-versioning style.

### When your PR needs a changeset

You **must** add a changeset if your PR touches any publishable package under `packages/*` (excluding `@nextly/eslint-config`, `@nextly/prettier-config`, `@nextly/tsconfig`, and the `playground` app, which are in the changeset `ignore` list).

The `changeset-check` CI job fails PRs that modify a publishable package without a changeset.

✅ **DO create a changeset for**: user-facing features, bug fixes, breaking changes, performance work, deprecations.

❌ **SKIP changeset for**: internal refactors with no user impact, docs-only edits, test-only changes, CI/tooling.

### Creating a changeset

```bash
pnpm changeset
```

The CLI will ask which packages changed. Because of `fixed[]`, whichever package you pick will pull the others along at publish time — just pick the primary one. Then choose the semver bump (`patch` / `minor` / `major`) and write a short user-facing summary.

Commit the generated `.changeset/*.md` file with your PR.

### How a release happens

1. You merge your PR (with its changeset) into `dev`.
2. [`.github/workflows/release.yml`](.github/workflows/release.yml) runs on `push` to `dev` and opens a `Version Packages` PR that bumps every `fixed[]` package by the same amount and rewrites per-package `CHANGELOG.md` files.
3. The Version Packages PR accumulates as more PRs land — so all pending changes ship together when it's merged.
4. A maintainer reviews and merges the Version Packages PR.
5. The release workflow runs again, this time publishing to npm:
   - `pnpm build`
   - `changeset publish` — publishes each package to `@revnixhq/*` with `--provenance` attestation
   - Creates one git tag `vX.Y.Z`
   - Creates one consolidated GitHub Release containing all package CHANGELOGs

### Pre-releases (alpha / beta / rc)

For pre-release versions, enter Changesets pre mode before merging changesets:

```bash
pnpm changeset pre enter alpha   # or beta, rc
git commit -am "chore: enter alpha pre mode"
git push
```

From this point, every release publishes alpha versions (`v1.0.0-alpha.0`, `v1.0.0-alpha.1`, …) tagged on npm with `--tag alpha`. Stable installs of `@revnixhq/nextly` are unaffected.

When ready for stable:

```bash
pnpm changeset pre exit
git commit -am "chore: exit alpha pre mode"
git push
```

The next release publishes `v1.0.0` stable.

### Rollback

If a bad version ships:

```bash
npm deprecate @revnixhq/<pkg>@<bad-version> "reason"
```

Then open a revert PR with a fresh changeset to cut the next patch.

---

## Internal architecture reference

The sections below document conventions inside specific packages. They're not required reading for casual contributions, but useful when working in `@revnixhq/nextly` (core) or `@revnixhq/admin`.

### Path alias conventions

Use path aliases instead of deep relative imports.

**In `@revnixhq/nextly`:**

```ts
// ✅ Good
import { UserService } from "@nextly/services/users";
import { hashPassword } from "@nextly/auth/password";
import { PostgresAdapter } from "@nextly/database/adapters/postgres";

// ❌ Bad
import { UserService } from "../../../services/users";
```

Available aliases: `@nextly/*` → `packages/nextly/src/*`, plus subpath aliases (`@nextly/services`, `@nextly/database`, `@nextly/auth`, `@nextly/hooks`, `@nextly/storage`, `@nextly/types`).

**In `@revnixhq/admin`:**

```ts
// ✅ Good
import { Button } from "@admin/components/ui/button";
import { useAuth } from "@admin/hooks/useAuth";
import { cn } from "@admin/lib/utils";
```

Available aliases: `@admin/*` → `packages/admin/src/*` (`@admin/components`, `@admin/hooks`, `@admin/lib`, `@admin/types`).

### Component organization (`@revnixhq/admin`)

Admin components follow a 4-tier structure:

```
packages/admin/src/components/
├── ui/           # Primitives (Button, Input, Dialog, Table)
├── features/     # Domain features (Dashboard, MediaLibrary, RoleManagement)
├── forms/        # Form components (field-types, FieldEditorDialog)
├── layout/       # Layout components (Sidebar, PageContainer)
├── shared/       # Cross-cutting (SearchBar, Pagination, ErrorFallbacks)
├── guards/       # Route guards
└── icons/        # Icon re-exports
```

- **Directories**: kebab-case (`user-dialog/`, `media-library/`)
- **Files**: PascalCase for components (`UserDialog.tsx`), `index.ts` for barrel exports
- **Exports**: named exports preferred

When creating a new component, pick the appropriate tier, create a kebab-case directory with an `index.ts` barrel, and use path aliases for internal imports.

### Service guidelines (`@revnixhq/nextly`)

Services in the core package follow these conventions:

- **File size**: keep service files under ~500 lines. Split large services into focused sub-services and compose.
- **Single responsibility**: e.g. `services/users/` splits into `user-query-service.ts`, `user-mutation-service.ts`, `user-account-service.ts` rather than one monolithic file.
- **Database access**: services access Drizzle ORM directly (no repository layer). Transactions are managed at the service level.
- **Error handling**: throw `ServiceError` from `@nextly/services/lib/errors`:

  ```ts
  import { ServiceError, ServiceErrorCode } from "@nextly/services/lib/errors";

  async findById(id: string): Promise<User> {
    const user = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) {
      throw new ServiceError(ServiceErrorCode.NOT_FOUND, "User not found");
    }
    return user;
  }
  ```

---

Thank you for contributing! If anything in this guide is unclear or out of date, please open a PR or start a [Discussion](https://github.com/nextlyhq/nextly/discussions).
