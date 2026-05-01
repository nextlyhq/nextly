# Contributing Guidelines

## Development Setup

### Prerequisites

- Node.js >= 18
- pnpm >= 9

### Installation

```bash
# Clone the repository
git clone https://github.com/nextlyhq/nextly.git
cd nextly

# Install dependencies
pnpm install

# Start the development loop (no `pnpm build` first — see "Development Workflow" below)
pnpm dev
```

### Development Workflow

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
- Prepare a release (changesets workflow runs build internally)

### Other Common Commands

```bash
# Type check all packages
pnpm check-types

# Run linter
pnpm lint

# Run tests
pnpm test
```

---

## Monorepo Structure

Nextly uses a pnpm + Turborepo monorepo. Key directories:

```
nextly-dev/
├── apps/
│   └── playground/          # Development/testing app
├── packages/
│   ├── nextly/              # Core CMS (nextly)
│   ├── admin/               # Admin UI (@revnixhq/admin)
│   ├── client/              # Client SDK (@revnixhq/client)
│   ├── ui/                  # Headless components (@revnixhq/ui)
│   ├── adapter-postgres/    # PostgreSQL adapter
│   ├── adapter-mysql/       # MySQL adapter
│   ├── adapter-sqlite/      # SQLite adapter
│   ├── eslint-config/       # Shared ESLint config
│   ├── tsconfig/            # Shared TypeScript config
│   └── prettier-config/     # Shared Prettier config
├── scripts/                 # Monorepo scripts
└── docs/                    # Documentation
```

---

## Working on Packages

### Core Package (nextly)

```bash
# Watch mode
pnpm dev:core

# Run tests
pnpm --filter nextly test

# Type check
pnpm --filter nextly check-types
```

### Admin Package (@revnixhq/admin)

```bash
# Watch mode
pnpm dev:admin

# Run tests
pnpm --filter @revnixhq/admin test

# Type check
pnpm --filter @revnixhq/admin check-types
```

### All Packages

```bash
# Build all packages
pnpm build

# Test all packages
pnpm test

# Type check all packages
pnpm check-types
```

---

## Import Guidelines

### In Core Package (nextly)

Use path aliases instead of deep relative imports:

```typescript
// ✅ Good - Use path aliases
import { UserService } from "@nextly/services/users";
import { hashPassword } from "@nextly/auth/password";
import { PostgresAdapter } from "@nextly/database/adapters/postgres";

// ❌ Bad - Avoid deep relative imports
import { UserService } from "../../../services/users";
import { hashPassword } from "../../lib/auth/password";
```

**Available aliases in nextly:**

- `@nextly/*` → `packages/nextly/src/*`
- `@nextly/services` → `packages/nextly/src/services`
- `@nextly/database` → `packages/nextly/src/database`
- `@nextly/auth` → `packages/nextly/src/auth`
- `@nextly/hooks` → `packages/nextly/src/hooks`
- `@nextly/storage` → `packages/nextly/src/storage`
- `@nextly/types` → `packages/nextly/src/types`

### In Admin Package (@revnixhq/admin)

```typescript
// ✅ Good - Use path aliases
import { Button } from "@admin/components/ui/button";
import { useAuth } from "@admin/hooks/useAuth";
import { cn } from "@admin/lib/utils";

// ❌ Bad - Avoid deep relative imports
import { Button } from "../../../components/Button";
import { useAuth } from "../../hooks/useAuth";
```

**Available aliases in @revnixhq/admin:**

- `@admin/*` → `packages/admin/src/*`
- `@admin/components` → `packages/admin/src/components`
- `@admin/hooks` → `packages/admin/src/hooks`
- `@admin/lib` → `packages/admin/src/lib`
- `@admin/types` → `packages/admin/src/types`

---

## Component Organization

Components in `@revnixhq/admin` follow a 4-tier structure:

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

### Component Naming

- **Directories:** kebab-case (`user-dialog/`, `media-library/`)
- **Files:** PascalCase for components (`UserDialog.tsx`), kebab-case for index (`index.ts`)
- **Exports:** Named exports preferred

### Creating New Components

1. Determine the appropriate tier (ui, features, forms, layout, shared)
2. Create a kebab-case directory
3. Add component file and index.ts barrel export
4. Use path aliases for internal imports

---

## Service Guidelines

Services in the core package (`nextly`) should follow these guidelines:

### File Size

- Keep service files under **500 lines**
- Split large services into focused sub-services
- Use composition for complex operations

### Single Responsibility

Each service should have a single, well-defined responsibility:

```typescript
// ✅ Good - Focused services
services/users/
├── user-query-service.ts      # Read operations
├── user-mutation-service.ts   # Write operations
└── user-account-service.ts    # Account management

// ❌ Bad - Monolithic service
services/users.ts              # 1000+ lines doing everything
```

### Database Access

- Services access Drizzle ORM directly (no repository layer)
- Use `ServiceError` for error handling (exception-based)
- Transactions managed at service level

```typescript
// Error handling pattern
import { ServiceError, ServiceErrorCode } from '@nextly/services/lib/errors';

async findById(id: string): Promise<User> {
  const user = await this.db.select().from(users).where(eq(users.id, id));
  if (!user) {
    throw new ServiceError(ServiceErrorCode.NOT_FOUND, 'User not found');
  }
  return user;
}
```

---

## Testing

### Test Suites (F18+)

Nextly has two test suites split by filename convention:

| Suite       | What it covers                                                                                | Run with                |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| Unit        | Logic that does not need a database. Pure functions, mocked services, type guards.            | `pnpm test:unit`        |
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

Step 1: Boot the test stack

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts:

- PostgreSQL 15 on port 5434 (Nextly's minimum supported version, F17)
- PostgreSQL 17 on port 5435 (current latest)
- PostgreSQL 16 on port 5433 (legacy default; will be removed in v2)
- MySQL 8.0 on port 3307

SQLite is in-memory and needs no service.

Step 2: Run integration tests against the dialect of your choice

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

Step 3: Tear down

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

### Other test-related commands

```bash
# Watch mode (unit suite)
pnpm --filter nextly test:watch

# Coverage (unit suite)
pnpm --filter nextly test -- --coverage
```

### Test Location

- Tests are co-located with source files in `__tests__/` directories
- Test files use `.test.ts` (unit) or `.integration.test.ts` (integration)
- Per-scenario integration tests live under `packages/nextly/src/database/__tests__/integration/`
- pushSchema fixtures live under `packages/nextly/src/database/__tests__/integration/__fixtures__/pushSchema/`

### Test Frameworks

- **Vitest** for unit and integration tests
- Two configs per package: `vitest.config.ts` (unit) and `vitest.integration.config.ts` (integration with 30s timeouts + singleFork pool)

### CI test workflows

Two GitHub Actions workflows run on every PR:

- `ci.yml` — lint, typecheck, build, and unit test suite. Lint + unit test currently `continue-on-error: true` due to legacy test debt (677 baseline failures pending separate triage task).
- `test-integration.yml` — the 3-dialect matrix (PG 15, PG 17, MySQL 8, SQLite). No `continue-on-error`; any failure blocks merge.

A PR is mergeable when all integration matrix jobs are green AND the build/lint/unit jobs pass (or are explicitly waived).

---

## Branch Naming Convention

### Format

```
<type>/<scope>/<short-description>
```

### Types

- `feature/` - New features
- `fix/` - Bug fixes
- `hotfix/` - Critical production fixes
- `chore/` - Maintenance tasks
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/updates
- `ci/` - CI/CD changes

### Scopes

- `nextly` - Core package (database, services, APIs)
- `admin` - Admin dashboard package
- `eslint-config` - ESLint configuration package
- `tsconfig` - TypeScript configuration package
- `prettier-config` - Prettier configuration package
- `playground` - Development playground app
- `root` - Root level changes

### Examples

```
feature/admin/user-authentication
fix/nextly/connection-pool-leak
hotfix/root/security-vulnerability
chore/eslint-config/update-dependencies
docs/admin/api-documentation
refactor/nextly/query-optimization
test/admin/user-service-tests
ci/root/github-actions-workflow
```

### Rules

- Use lowercase letters and hyphens only
- Keep descriptions concise but descriptive
- Maximum 50 characters total
- No spaces or special characters except hyphens

---

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat` - New features
- `fix` - Bug fixes
- `docs` - Documentation changes
- `style` - Code style changes (formatting, semicolons, etc.)
- `refactor` - Code refactoring without changing functionality
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `build` - Build system or dependency changes
- `ci` - CI/CD configuration changes
- `chore` - Maintenance tasks
- `revert` - Revert previous commits

### Scopes

- `nextly` - Core package (database, services, APIs)
- `admin` - Admin dashboard package
- `eslint-config` - ESLint configuration package
- `tsconfig` - TypeScript configuration package
- `prettier-config` - Prettier configuration package
- `playground` - Development playground app
- `root` - Root level changes

### Description Rules

- Use imperative mood ("add" not "added" or "adds")
- Start with lowercase letter
- No period at the end
- Maximum 72 characters
- Be descriptive but concise

### Examples

```bash
feat(admin): add user authentication with JWT
fix(nextly): resolve connection pool memory leak
docs(root): update README with setup instructions
style(admin): format user service according to prettier rules
refactor(nextly): extract query builder into separate module
perf(admin): optimize user data fetching with caching
test(nextly): add integration tests for user repository
build(root): update dependencies to latest versions
ci(root): add automated security scanning workflow
chore(eslint-config): update ESLint rules for TypeScript 5.0
revert(admin): revert "add experimental feature"
```

### Body Guidelines

- Separate from description with a blank line
- Wrap at 72 characters
- Explain the "what" and "why", not the "how"
- Reference issues and pull requests when applicable

### Footer Guidelines

- Use for breaking changes: `BREAKING CHANGE: <description>`
- Reference issues: `Fixes #123`, `Closes #456`
- Co-authored commits: `Co-authored-by: Name <email>`

---

## Pull Request Guidelines

### Title Format

Same as commit message format:

```
<type>(<scope>): <description>
```

### Description Template

```markdown
## Summary

Brief description of changes made.

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Code refactoring
- [ ] Performance improvement
- [ ] Test addition/update

## Affected Packages

- [ ] nextly
- [ ] admin
- [ ] eslint-config
- [ ] tsconfig
- [ ] prettier-config
- [ ] playground
- [ ] root

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] No regression in existing functionality

## Screenshots (if applicable)

Add screenshots to help explain your changes.

## Related Issues

- Fixes #(issue number)
- Closes #(issue number)
- Related to #(issue number)

## Additional Notes

Any additional information that reviewers should know.
```

### Review Requirements

- [ ] At least 1 reviewer approval required
- [ ] All CI checks must pass
- [ ] No merge conflicts
- [ ] Branch is up to date with target branch
- [ ] All conversations resolved

### Merge Strategy

- Use **Squash and Merge** for feature branches
- Use **Merge Commit** for release branches
- Use **Rebase and Merge** for hotfixes

### Branch Protection Rules

- Require pull request reviews before merging
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Restrict pushes to matching branches (main/develop)

---

## Pre-commit Hooks

The following hooks are automatically executed:

### Pre-commit

- Code formatting with Prettier
- Linting with ESLint (if applicable)

### Commit-msg

- Validates conventional commit format
- Ensures proper scope usage

### Pre-push

- Runs build process
- Ensures all packages compile successfully

---

## Release Process

Nextly uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing. All 13 publishable `@revnixhq/*` packages are kept in lockstep (same version at all times) via the `fixed` array in [.changeset/config.json](.changeset/config.json) — this matches Payload CMS's unified-versioning style.

### When your PR needs a changeset

You **must** add a changeset if your PR touches any publishable package under `packages/*` (excluding the `@nextly/eslint-config`, `@nextly/prettier-config`, `@nextly/tsconfig` configs and the `playground` app, which are in the `ignore` list).

The `changeset-check` CI job fails PRs that modify a publishable package without a changeset.

✅ **DO create a changeset for**: user-facing features, bug fixes, breaking changes, performance work, deprecations.

❌ **SKIP changeset for**: internal refactors with no user impact, docs-only edits, test-only changes, CI/tooling.

### Creating a changeset

```bash
pnpm changeset
```

The CLI will ask which packages changed. Because of `fixed[]`, whichever package you pick will pull the other 12 along at publish time — just pick the primary one. Then choose the semver bump (`patch` / `minor` / `major`) and write a short user-facing summary.

Commit the generated `.changeset/*.md` file with your PR.

### How a release actually happens

1. You merge your PR (with its changeset) into `dev`.
2. [.github/workflows/release.yml](.github/workflows/release.yml) runs on `push` to `dev` and opens a `Version Packages` PR that bumps every `fixed[]` package by the same amount and rewrites per-package `CHANGELOG.md` files.
3. A maintainer reviews and merges the Version Packages PR.
4. The release workflow runs again, this time publishing to npm:
   - `pnpm build`
   - `changeset publish` — publishes each package to `@revnixhq` with `--provenance` attestation
   - Creates one git tag `vX.Y.Z`
   - Creates one GitHub Release

### What I can't do

- **Push directly to `dev`** — branch protection blocks it.
- **Bypass CI** — the `changeset-check`, `pr-title`, lint, typecheck, build, test, `publint`, and `arethetypeswrong` jobs are all required.
- **Publish manually from my laptop** — only the release workflow has the `NPM_AUTH_TOKEN`.

### Rollback

If a bad version ships:

```bash
npm deprecate @revnixhq/<pkg>@<bad-version> "reason"
```

Then open a revert PR with a fresh changeset to cut the next patch.

---

## Additional Guidelines

### Code Quality

- Write self-documenting code
- Add comments for complex logic
- Follow existing code style
- Ensure test coverage for new features

### Documentation

- Update README files when adding new features
- Document API changes
- Update configuration examples
- Keep changelog updated

### Security

- Never commit secrets or API keys
- Use environment variables for sensitive data
- Follow security best practices
- Report security vulnerabilities responsibly

### Performance

- Consider performance impact of changes
- Profile critical code paths
- Optimize database queries
- Minimize bundle size for frontend packages
