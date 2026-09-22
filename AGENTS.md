# Nextly Monorepo: Agent Guide

Nextly is an open-source, Next.js-native content platform: a CMS and a Visual
Page Builder. Users define
content schema in TypeScript (code-first) or visually (the Schema Builder), and
it runs inside their own Next.js app with their own database (Postgres, MySQL,
or SQLite via Drizzle ORM). This repository is the pnpm + Turborepo monorepo
for all published packages. Status: alpha, all packages version in lockstep.

## Skills, and when to load one

Procedures live in `.claude/skills/` rather than here, because a procedure
needed once per task should not occupy context in every session. This table is
the router: Claude selects a skill from its description, and the table is what
survives a description that underperforms. Load the skill BEFORE the act, not
after it goes wrong.

| Load this                     | When you are about to                                   |
| ----------------------------- | ------------------------------------------------------- |
| `testing-evidence`            | add, change, delete or judge a test                     |
| `writing-integration-tests`   | write or debug a `*.integration.test.ts`                |
| `adding-a-field-type`         | add a field type to the catalog                         |
| `derived-checks`              | write or review a check, gate, probe or derived view    |
| `auditing-an-instrument`      | act on a clean, empty or surprising result from a check |
| `reading-a-ci-verdict`        | read CI, check runs or a reviewer verdict               |
| `reviewing-a-pr`              | review a PR or answer review-bot findings               |
| `verifying-merged-work`       | confirm a change landed, or judge a red after a rebase  |
| `recovering-a-clobbered-file` | recover a file a whole-file write may have replaced     |
| `release-and-changesets`      | touch a changeset, a release or a new package name      |

Two rules stay loaded in every session (`.claude/rules/`) because the failures
they prevent arrive before any file has been read: `whole-file-writes` (a shell
redirect reads nothing, so there is no read for a path-scoped rule to trigger
on) and the path-scoped `integration-tests`.

## Repository map

- `packages/nextly` - core: config surface, Direct API, REST dispatcher, CLI,
  auth, schema pipeline, migrations. Publishes `nextly` with many export
  subpaths (`nextly/config`, `nextly/runtime`, `nextly/field-catalog`, ...).
- `packages/admin` - the admin panel UI (`@nextlyhq/admin`).
- `packages/adapter-{drizzle,postgres,mysql,sqlite}` - database adapters.
  `adapter-drizzle` is shared logic; the per-dialect adapters extend it.
- `packages/blocks-engine` - the runtime-free block document model, validation
  and style compiler. `packages/blocks-react` - the React/RSC renderer for those
  documents; its root entry imports no `next/*`, no admin and no CMS runtime, so
  it is usable standalone (enforced by `src/layering.test.ts`). Next-coupled
  helpers live at the `/next` subpath.
- `packages/builder` - the visual page-builder editor (shell, canvas, op store).
  It reaches admin only through `plugin-sdk/admin`, and imports nothing outside a
  short allowlist of exact specifiers - both enforced by `src/layering.test.ts`.
  That it draws with `blocks-react` rather than a renderer of its own is a
  review-time convention, NOT a checked one: reimplementing rendering on React
  and `blocks-engine` imports exactly the same packages, so no import guard can
  tell the two apart.
- `packages/plugin-sdk` - the ONLY stable import surface for plugin authors.
- `packages/plugin-{form-builder,page-builder}` - first-party plugins.
- `packages/storage-{s3,vercel-blob,uploadthing}` - media storage adapters.
- `packages/create-nextly-app` - scaffolding CLI. Templates live in
  `/templates` (`base`, `blank`, `blog`, `plugin`).
- `packages/ui` - shared React components and the design-token theme.
- `packages/admin-css`, `packages/eslint-plugin`, `packages/module-specifiers`,
  `packages/eslint-config`, `packages/prettier-config`, `packages/tsconfig`,
  `packages/telemetry` - shared tooling and support packages.
- `apps/playground` - contributor dev harness (not published).
- `e2e/` - Playwright suite. `docs/` - user docs (MDX, deployed to
  nextlyhq.com/docs). Nothing here renders them: the site fetches and
  compiles them at its build, so `pnpm check:docs-compile` compiles every page
  with the same MDX compiler, parses its frontmatter as the site's loader does,
  and holds the components it uses to `docs/components.json`, the contract the
  site registers from the other side. CI refuses a page that would not render.
- `context7.json` - what Context7 indexes for coding agents: `docs/` and the
  root README, with every other root Markdown file excluded by name (Context7
  reads root-level Markdown whatever `folders` says). Its description is held
  to the core package's by `check-docs-claims`; `pnpm check:context7-index`
  reads back what the live index cites, and exits 2 rather than 0 while the
  library is unregistered.

Before editing a package, read its README.md and check for a nested AGENTS.md.

## Setup and dev loop

- Requirements: Node `^20.19.0 || ^22.12.0 || >=24.0.0`, pnpm 12.5.1
  (`packageManager` is pinned in `package.json`; Corepack enforces the exact
  version). The ranges are disjoint deliberately, mirroring what the test
  environment supports: 20.6-20.18 and the whole 23.x line are excluded, not
  merely untested.
- Two different facts, deliberately not one: `engines.node` above is the
  CONTRACT the published packages make, and `.nvmrc` (24.21.0) is the version
  contributors, CI and the release job actually run. Every workflow reads
  `.nvmrc`, so the toolchain moves by editing that file; narrowing `engines`
  would drop Node 20/22 for users and is a separate decision. `package-smoke`
  derives its Node legs FROM `engines.node`, so the floors stay tested.
- pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc` and not a `pnpm`
  block in `package.json` — pnpm reads only auth and registry settings from
  `.npmrc`, and ignores anything else there in silence.
- Install: `pnpm install`.
- Dev harness: `pnpm dev:app` starts the playground on :3000 (SQLite by
  default; `pnpm dev:postgres` / `pnpm dev:mysql` for other dialects, with
  services from `pnpm docker:up`). It seeds a dev user and auto-logs-in to
  `/admin` (dev-only; the credentials are `dev@nextly.local` /
  `DevPassword123!`, and auto-login is hard-blocked in production).
- There is no `nextly dev` CLI command by design: user apps run plain
  `next dev`, and schema changes apply in-process via the HMR listener.

## Working in several checkouts at once

Never work a PR branch in the shared checkout: another session switching
branches underneath you removes files mid-command. Use a worktree, and give it
a SLOT, because three things in this repository are per-machine rather than
per-checkout.

```
pnpm worktree new <branch> [--from <ref>]   # create, claim a slot, report it
pnpm worktree list                          # who holds which slot
pnpm worktree remove <branch|path>          # give the slot, ports and databases back
pnpm worktree provision                     # create this slot's databases, after docker start
pnpm worktree sweep                         # release slots whose databases outlived them
pnpm worktree env --slot <n>                # the exports, for a plain shell
```

**Removal is not destructive by default.** It refuses a checkout with
uncommitted work and keeps a branch git will not fast-forward delete; `--force`
opts into losing both. It matches the target by EXACT branch or path, never by
prefix, because a near-miss there removes somebody else's checkout.

**Remove it when you are finished.** Slots are small integers and an abandoned
checkout holds its ports and its databases indefinitely. `remove` drops the
slot's databases before it removes the checkout, so a later `new` cannot take
the slot while the old databases still hold another run's tables. It never
touches slot 0, which is the shared default.

A slot owns a contiguous BLOCK of ports and one database. Slot 0 is the
documented defaults — `PORT` 3000, `E2E_PORT` 3100, `E2E_PROD_PORT` 3101 — and
every allocated slot takes ten consecutive ports from 3200 upward, so no two
slots and no slot and default can ever meet. Independent per-port series cannot
promise that: at 3000 + 10n and 3100 + 10n, slot 10's playground port IS slot
0's e2e port. Its database is `nextly_test`, then `nextly_test_w<n>`.

The slot is claimed by creating a file under the shared `.git` directory with
an exclusive create, so two agents running `new` at once cannot be given the
same number. It writes the environment into that worktree's
`.claude/settings.local.json`, which is gitignored and per-checkout, so a
Claude Code session started there picks them up with no further setup. **Slot 0
is the documented defaults**, so a checkout that never runs this is unchanged.

The two port collisions are obvious. The third is not, and it fails as a flaky
test rather than as a collision: test-owned tables get a random per-file prefix,
but Nextly's SYSTEM tables have fixed names (`nextly_schema_events` and its
neighbours) and cannot be prefixed. Within one run `fileParallelism: false`
handles that. Across two worktrees pointed at the same `nextly_test` it is not
handled at all — the second run drops and recreates a system table the first is
still using. Hence a separate DATABASE per slot rather than a prefix.

The CONTAINERS stay shared. They set a fixed `container_name`, so exactly one
compose project can own them and a second worktree bringing up its own fails on
the taken names. `pnpm worktree new` creates its database inside whichever test
containers are RUNNING and says which it skipped; run `pnpm worktree provision`
in that checkout once they are up. A create that fails against a container that
is up is an error rather than a skip — the integration lanes self-skip when they
cannot connect, so a missing database would otherwise read as a passing run.

If a removal cannot drop its databases, the slot is RESERVED rather than
released, and `pnpm worktree list` says so. Reissuing it would hand the next
checkout another run's fixed-name system tables. `pnpm worktree sweep` drops
them and releases the slot once the containers are back.

`NEXTLY_TEST_DB` carries a database NAME, never a URL: Postgres 15 is on 5434
and Postgres 17 on 5435, so a single `TEST_POSTGRES_URL` in the environment
would point the `:postgres15` lane at the 17 container and report a pass for a
version it never ran against.

One more shared thing the slot does NOT cover: `git stash` is per-clone, not
per-worktree, so a stash pushed in one checkout is visible — and poppable — in
every other. Prefer a branch commit to a stash when several sessions are live.

## Build and test (read this before running anything)

- `pnpm build` builds all packages (turbo, dependency order).
- Exact failure counts and other perishable numbers live in
  `AGENTS.measured.md`, GENERATED by `node scripts/measure-facts.mjs`
  (`--full` for the forced turbo runs) — figures quoted in the prose below
  are the EVENTS that taught each lesson, not the current state.
- `pnpm check-types` and `pnpm lint` BOTH need a build first. On a clean
  checkout, measured with the cache forced off so the numbers are of work that
  actually ran:

  | command                                         | result on a clean tree                    |
  | ----------------------------------------------- | ----------------------------------------- |
  | `pnpm turbo run check-types --continue --force` | `AGENTS.measured.md` → `check-types-cold` |
  | `pnpm turbo run lint --continue --force`        | `AGENTS.measured.md` → `lint-cold`        |

  `check-types` fails because a workspace import resolves through the sibling's
  package exports to a `dist/index.d.ts` that does not exist yet. `lint` fails
  for the same underlying reason through a different rule: `import-x/no-unresolved`
  resolves the same specifiers, so an unbuilt sibling is an unresolved import.

  Run `pnpm build` first. The failure is workspace-wide rather than local to one
  package, so the whole-repo build is the honest default.

  To check one package, build it WITH its dependencies:

  ```
  pnpm --filter <pkg>... build      # trailing ... includes <pkg> itself
  ```

  Not `<pkg>^...`. `pnpm recursive --help` defines that form as the dependencies
  "without including the matched packages", so the package's own `dist` stays
  absent — and `lint` then fails on its self-imports, which is the same missing
  build wearing a different rule's error message.

  **Two states distort these numbers in OPPOSITE directions, and neither is
  visible in the summary line.** A warm cache overstates health; a missing
  `dist` overstates breakage. Measured from both ends: with the cache warm this
  entry first recorded 19 of 21 passing and `lint` clean, and on a freshly
  installed tree with nothing built another lane saw `pnpm lint` fail with 361
  `@nextlyhq/ui` resolution errors and vitest unable to collect at all. Same
  repository, same commit.

  So state the cache AND the build state when you quote a number.

  **Measure with `--force`.** Turbo caches both tasks, and a cached task
  reports `Tasks: N successful` without running anything — so a warm cache from
  an earlier built state reports a clean tree as passing. That is not a
  hypothetical: the first version of this entry claimed 19 of 21 passing and
  `lint` clean at 22 of 22, and both numbers came from cache hits.

  `TS2307` naming a workspace package (`nextly/...`, `@nextlyhq/...`) is USUALLY
  a missing build, and the rebuild is what confirms it. It is not proof on its
  own: a misspelled specifier, a removed export-map subpath, or a broken
  tsconfig path mapping produces exactly the same error, and no amount of
  rebuilding fixes those. If the error survives a successful build of that
  package AND its dependencies — the `<pkg>...` form above, not `^...` — it is a
  real resolution defect — see
  the `verifying-merged-work` skill, which says to check what `main`
  changed before calling any of this environmental.

  **A stale or missing sibling `dist` does not only produce `no-unresolved`.**
  Every TYPE-AWARE lint rule reads inferred types, so an unbuilt tree makes it
  report on types the checker cannot see: measured here, a docs-only commit
  failed `nextly#lint` with `@typescript-eslint/no-unnecessary-type-assertion`
  on a load-bearing assertion, and `pnpm --filter nextly... build` cleared it
  along with the `no-unresolved` error beside it.

  That is the dangerous half, because the two errors read differently. An
  unresolved import NAMES A PACKAGE and reads as environmental. A type-aware
  finding names YOUR EXPRESSION and reads as a correctness defect — and its
  obvious remedy, deleting the assertion, is a real regression that lints clean
  afterwards on a built tree, because the assertion it was protecting is gone.
  Build before you believe any lint result, not only one that names a module.
  There is no tell in the message.

  Path mappings cover part of this and are not a general answer.
  `packages/admin` maps the bare `nextly` specifier to `../nextly/src`, which is
  why admin resolves it without a build while `packages/plugin-sdk`, which has
  no such mapping, does not. Subpaths like `nextly/config` and
  `nextly/field-catalog` are not covered by that mapping and still need `dist`.

- CRITICAL: integration tests require built packages. Run them from the ROOT
  (`pnpm test:integration...`) so turbo builds first. Running
  `pnpm --filter nextly test:integration` on an unbuilt tree fails 60+ files
  with self-import errors that look real but are not.
- Integration tests self-skip when the dialect's URL is unset. Use the root
  scripts: `pnpm test:integration:postgres17` (localhost:5435),
  `:postgres15` (:5434), `:mysql` (:3307), `:sqlite` (no URL needed). NEVER
  point a TEST\_\* URL at a database you did not create for the test run.
- The test databases are their own containers in `docker-compose.test.yml`,
  separate from the dev stack. Neither `pnpm docker:test` nor `pnpm docker:up`
  starts them: `docker:test` only PROBES a connection and exits 1 when it
  fails, and `docker:up` brings up the DEV stack, which conflicts by container
  name where one already exists. A `DBS DOWN` failure followed by a start
  command that changes nothing reads like a broken environment; it is usually
  just the wrong command.
  - Already created but stopped, which is the usual case:
    `docker start nextly-postgres17-test nextly-mysql-test` (add
    `nextly-postgres15-test` for the 15 leg).
  - Never created, on a fresh clone:
    `docker compose -f docker-compose.test.yml up -d postgres17-test postgres15-test mysql-test`.
    `postgres15-test` is the only service on 5434, so omitting it leaves the
    documented `:postgres15` leg with nothing to connect to.
  - Why not always the second: the services set a fixed `container_name`, so
    exactly one compose project can own them, and the owner is whichever
    directory first brought them up. In a repo worked through many worktrees
    that is rarely the one you are standing in, and compose then tries to
    CREATE containers whose names are taken and fails. `docker start` addresses
    them by name and does not care which project owns them.
- Integration files in `packages/nextly` run sequentially on purpose
  (`fileParallelism: false`, single fork): system-table suites share fixed
  table names. Do not "fix" slow integration runs by re-enabling parallelism.
- E2E: the root `e2e/` package (Playwright) boots its own playground on :3100
  with a fresh SQLite database per run.
- Some unit suites have a known pre-existing failing baseline. NEVER add to
  it: run the tests for the area you touch before and after your change, and
  fix any new failure you introduce.
- A test is only evidence once you have watched it FAIL for the intended
  reason, and a green that both the fixed and the broken implementation
  produce is worse than no test. How to establish that — break-verification,
  the property that SEPARATES a correct implementation from the plausible
  broken one, auditing the instrument you are judging with, and when deleting
  a test is the right call — is the `testing-evidence` skill. Load it before
  adding, changing or judging a test.

## How much of the machine a local gate may take

`.husky/pre-push`, `pnpm verify:pr` and `pnpm verify:full` size themselves to
the machine they run on. `pnpm local-limits` prints what this machine gets.

The gates fan out two levels: turbo runs several package tasks at once, and
each task running Vitest spawns several workers. **The product is what consumes
the machine**, and both defaults are large — `turbo --concurrency` defaults to
10, and Vitest's `maxWorkers` defaults to `os.availableParallelism()`. On an
eight-core machine that reaches up to 80 Node processes, each with its own V8
heap, which exhausts an ordinary development machine. The kernel's response to
that is to kill processes, not to slow down.

`scripts/local-limits.mjs` budgets the total number of heavy processes from
total memory and core count, then splits it into the two knobs. Roughly:

| Machine         | package tasks | workers each | peak processes |
| --------------- | ------------- | ------------ | -------------- |
| 4 GiB / 4 cpu   | 1             | 1            | 1              |
| 8 GiB / 4 cpu   | 1             | 3            | 3              |
| 16 GiB / 8 cpu  | 2             | 3            | 6              |
| 64 GiB / 32 cpu | 4             | 4            | 16             |

A FIXED number would be wrong for everyone: one that protects a small laptop
makes a workstation crawl, and either way the gate gets bypassed. Deriving it
is what lets the same command be correct on both.

**Concurrency is not correctness.** The cap changes how many tasks run at once,
never which ones, so a bounded gate asks exactly what an unbounded one asked.

Override it for one command when you have headroom, or permanently in your
shell profile when you do not:

```sh
NEXTLY_LOCAL_CONCURRENCY=6 NEXTLY_LOCAL_MAX_WORKERS=4 git push
```

A malformed override is ignored rather than honoured, because an empty
`NEXTLY_LOCAL_CONCURRENCY=` in a profile would otherwise restore turbo's
default of 10 — the failure the bound exists to prevent, arriving silently.

### By operating system

Everything above is platform-independent: `os.totalmem()` and
`os.availableParallelism()` report correctly on all four. What differs is what
else is competing for the machine.

- **Linux** — nothing special. The budget reserves 30% for the OS and your
  editor.
- **macOS** — the same, though a machine with unified memory shares it with the
  GPU; if you run a heavy simulator alongside, lower the override.
- **Windows** — run hooks from Git Bash or another POSIX shell; husky hooks are
  `sh` scripts. Defender's real-time scanning of `node_modules` costs more than
  concurrency does, so exclude the repository directory from it before tuning
  anything else.
- **WSL2** — the VM's memory is what `os.totalmem()` reports, and it is set in
  `.wslconfig` on the Windows side rather than by the distribution. That file is
  per-machine and belongs on the machine, never in this repository. Keep the
  repository on the Linux filesystem: a checkout under `/mnt/c` crosses the
  9p filesystem boundary for every file operation and is far slower than any
  concurrency setting can compensate for.

Run one heavy phase at a time, and never a unit suite while an integration leg
is in flight.

## Conventions (enforced; violations will be rejected in review)

- Conventional Commits: commitlint (husky) checks the FORMAT; the PR-title
  check is what enforces the scope LIST below (commitlint extends
  config-conventional only, so it accepts any scope).
  Allowed PR scopes are package-based (`nextly`, `admin`, `admin-css`, `ui`,
  `adapter-postgres`, `adapter-mysql`, `adapter-sqlite`, `adapter-drizzle`,
  `storage-s3`, `storage-vercel-blob`, `storage-uploadthing`,
  `plugin-form-builder`, `plugin-mcp`, `plugin-page-builder`, `plugin-seo`,
  `plugin-sdk`,
  `blocks-engine`, `blocks-react`, `builder`,
  `create-nextly-app`, `eslint-config`, `eslint-plugin`, `module-specifiers`,
  `prettier-config`, `tsconfig`,
  `telemetry`, `client`) plus `playground`, `root`, `ci`, `docs`, `deps`,
  `release`. Scope is optional; the subject must not start with an uppercase
  letter. Subsystem names are not valid scopes.
- Errors thrown inside `packages/nextly/**` PRODUCT CODE use `NextlyError`
  (static factories: `notFound`, `forbidden`, `validation`, `conflict`,
  `duplicate`, `authRequired`, `invalidCredentials`, `rateLimited`,
  `internal`, ...), never bare `Error`. The admin package is exempt: it
  consumes the typed `{ error: { code, message, requestId, data? } }` envelope
  via `parseApiError`. Test files are also exempt: fixtures model driver and
  database failures arriving from OUTSIDE the package, which `NextlyError`
  cannot faithfully represent — wrapping them would make every negative test
  pass on the wrong error shape.
- Database access is Drizzle ORM only. No raw SQL strings in product code.
  Test fixtures reuse the production DDL helpers (for example
  `getSchemaEventsDdl`), never hand-copied CREATE TABLE statements.
- Every code change includes a comment explaining what and why. Comments
  describe the code only: never reference tasks, plans, conversations, or
  review findings.
- No `as any`, `@ts-expect-error`, or eslint-disable to silence type or lint
  errors. Fix the cause with real types, guards, or generics.
- API responses use the canonical envelopes in
  `packages/nextly/src/api/response-shapes.ts` (`{ items, meta }` for lists,
  `{ message, item }` for mutations). Never invent a new response shape.
- Admin styling is token-driven: use `--nx-*` custom properties (defined for
  light AND dark in `packages/ui/src/styles/theme.css`). Zero hardcoded
  colors, and every visual change must work in both modes.
- One question has ONE implementation. When a narrower view of something is
  needed, DERIVE it from the richer one; never compute it alongside. Two
  functions that agree today drift, and the drift is silent because both look
  correct. This has produced defects in five unrelated packages.
- Unreachability is a property of the current call graph, not of the code, and
  the call graph changes underneath you. "This cannot happen" is not a reason to
  omit a guard — it is a reason the guard is CHEAP, provided it is cheap: an
  assertion over values already in hand costs nothing when its rejection branch
  never runs. A guard that queries, reads or recomputes still pays that cost on
  every call whether or not it can ever reject, so a purely DEFENSIVE one can
  move behind the work it protects. Never move a guard that is a PRECONDITION —
  authorization, ownership, validity, quota. "Behind the work" there means the
  mutation has already happened when the request is rejected, which turns a cost
  saving into a security hole. Preconditions run first, whatever they cost.
- Prefer a boundary the system cannot cross to a check that looks for crossings.
  A scan over syntax has an unbounded surface and can only ever be patched; a
  declared dependency graph, a type, or a manifest assertion is complete by
  construction. But a manifest assertion is only a boundary if the RESOLVER
  agrees with it: under pnpm a root dependency, or one hoisted for another
  workspace package, stays importable from a package whose own manifest never
  declares it, so "X is absent from this package.json" does not mean "this
  package cannot reach X". Make the boundary real before trusting it — a
  resolution test that imports the package's entry from an isolated context, or
  a build that fails on an undeclared import — and only then drop the visitor.
- A documented rule with nothing enforcing it is not a control, and filing a
  task is not installing one. If the correct path and the easy path differ,
  the rule will be broken by someone who knows it.

## Changesets and releases

- ONE changeset per PR, covering ALL published packages (they version in
  lockstep), always `patch` while in alpha.
- Test-only, CI-only, or docs-only PRs get NO changeset.
- Releases are CI-only: the Changesets bot opens a Version PR, and merging it
  publishes via npm trusted publishing. Never attempt to publish locally.
- ONE narrow exception, for claiming a package name that does not exist on npm
  yet: npm can only attach a Trusted Publisher to a package that already exists,
  and OIDC cannot make a package's first publish, so a new package cannot
  bootstrap itself from CI. `scripts/release/bootstrap-package.mjs` publishes a
  `0.0.0` placeholder containing no code (`package.json` + `README` only) to
  claim the name; it refuses to run when `CI` is set, so this never becomes a
  long-lived npm token in a workflow. Every real version still publishes only
  from CI. Claiming the name is only half of it: attach the package's Trusted
  Publisher at npmjs.com (repository `nextlyhq/nextly`, workflow `release.yml`,
  environment `Production`) and then add the package to
  `scripts/release/first-publish-acknowledged.json` in the same PR that adds it.
  Preflight refuses to start a release while a package carries only its
  placeholder and is missing from that list, because a publish without a trusted
  publisher answers 404 and would strand it after the rest of the train is
  already live. Details: the `release-and-changesets` skill.

## Clean up what you started

Anything a task brings up, that task takes down. Containers started to verify
something, worktrees created for a branch, throwaway branches, scratch files
and test databases all get removed when the work is done — not left for the
next person to find and wonder about.

The same applies to anything you WRITE here. Tooling that allocates a resource
ships its teardown in the same change, not as a follow-up: a `create` with no
matching `remove` leaks whatever is scarce, and what is scarce is rarely disk.

```sh
docker stop nextly-postgres17-test nextly-postgres15-test nextly-mysql-test
pnpm worktree remove <branch>
```

Stopping the test containers is safe and cheap — `docker start` by name brings
them back with their data, which is why the start commands above are `start`
rather than `compose up`.

## Git and PR rules

- Never commit directly to main. Branch, open a PR, request review.
- Do not add "Generated with Claude Code", Co-Authored-By AI trailers, or any
  other AI attribution to commits or PR bodies.
- Husky runs gitleaks + lint-staged on commit, commitlint on the message, and
  lint + build on push. Never bypass hooks with `--no-verify`; if a hook
  fails, fix the cause.
- Pre-existing lint or type failures may be left alone (mention them in the
  PR); introducing new ones is not acceptable.

## Code Review Rules

For the automatic reviewer. CI already decides formatting, types, lint, the
comment convention, changeset presence, design tokens and bare `Error` in
product code, so none of those belong here — a reviewer relitigating a
mechanical check costs a round and settles nothing. What follows is the
consequential behaviour no check in this repository can judge.

### Published surface is a compatibility contract

`packages/nextly` publishes many export subpaths and every package versions in
lockstep. Flag a removed, renamed or retyped export, a narrowed parameter, a
widened return, or a changed default, unless the pull request states the
compatibility decision and what consumers should do instead. Adding an export
is safe; changing what an existing one means is not.

### Behaviour must match across database dialects

Postgres, MySQL and SQLite are all supported through `adapter-drizzle`. Flag a
change to query building, DDL, migrations or type mapping that alters
observable behaviour on one dialect without either covering the others or
documenting the limitation as deliberate. Field-to-column mapping has one home
(`packages/nextly/src/domains/schema/services/field-column-descriptor.ts`); an
adapter that starts mapping field types is the defect, not a local fix.

### `plugin-sdk` is the only stable plugin surface

Flag a plugin or builder reaching into `nextly` or `@nextlyhq/admin` internals
rather than through `@nextlyhq/plugin-sdk`, and flag a new export added to the
SDK without a statement that it is intended to be stable. The safe path is to
widen the SDK deliberately, not to bypass it.

### A precondition runs before the work it guards

Authorization, ownership, validity and quota checks must execute before the
mutation they protect. Flag any reordering that moves one behind the work for
cost reasons: the request is then rejected after the state has already changed,
which turns a saving into a security hole. Defensive assertions over values
already in hand may move; preconditions may not.

### Access decisions have one path

`overrideAccess: false` is judged by a single gate. Flag a second place that
decides whether a caller may read or write, a hand-assembled caller literal
instead of `readAccessCaller`, or a rule handed the stored `action-resource`
permission spelling rather than the rule-facing `resource:action` one. Two
doors that answer one key differently is a defect this repository has already
had.

### One question has one implementation

Flag a narrower view computed alongside the richer one rather than derived from
it — a count kept beside a list, a summary recomputed from the same inputs, a
test that reconstructs the call it is watching instead of observing it. Two
implementations agree on the day they are written and drift silently after,
because both look correct in isolation.

### A test must separate correct from plausibly broken

Flag a test whose assertion a plausible broken implementation would also
satisfy: a length bound a plain truncation meets, an assertion satisfied by
absence, a fixture that never reaches the mechanism, an `@ts-expect-error` that
would suppress an unrelated error on the same line. Say which property is
uncovered and what would distinguish the two implementations. Flag a suite that
silently stopped being discovered; a deliberate removal is a different act and
the pull request should say which test went and why.

### Stored data and migrations are hard to reverse

Flag a migration that drops or rewrites existing rows or columns, a change to
an established storage spelling, or a schema change that an existing
installation would silently fail to receive, unless the pull request names the
compatibility decision. Reaching existing databases is the part that gets
missed.

---

<!-- fallow:setup-hooks:start -->

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `"audit": { "gate": "all" }` in `.fallowrc.jsonc` to gate every finding in changed files.

This gate reads the DIFF, and `.github/workflows/code-hygiene.yml` runs in two jobs. Its `Changed files` job runs `audit --gate new-only` via the official `fallow-rs/fallow` action, gating on newly introduced dead code and duplication in changed files, adding inline annotations and PR review threads on offending lines (with `apps/playground` excluded). Its `Whole repository` job scans the entire repository at the PR branch HEAD to post a sticky PR comment and step summary covering dead code, duplication, and code health.

What CI ENFORCES and where it enforces it: `Changed files` gates on introduced DEAD CODE and introduced DUPLICATION in the PR's changed files (failing the PR check and posting PR review threads). The whole-repo job provides comprehensive visibility into repository-wide dead code, duplication, and complexity via a sticky PR comment, failing only on tooling crashes.

A degraded run is the failure mode worth knowing about, because it reports nothing and looks identical to a clean one. The gate job reads the action's `changed-files-unavailable`, `post-skipped-reason` and `dedup-lookup-failed` outputs and refuses on an unscoped analysis or an empty verdict, naming itself a tooling failure rather than a finding in the change.

`.claude/hooks/fallow-gate.sh` is VENDORED rather than left as `fallow hooks
install` writes it. The generated script parses JSON with `jq` and compares
versions with `sort -V`, and neither is safe to assume here: `jq` is not a
dependency of this repository, and BSD `sort` has no `-V`, so on macOS the
version check aborts the hook under `set -euo pipefail`. Both are done with
node in the vendored copy, which every contributor already has — the engines
field requires it and nothing in this repository runs without it. So the gate
needs no tool a contributor does not already have installed.

That has a maintenance cost worth knowing: re-running `fallow hooks install
--target agent` OVERWRITES the file and silently puts both back. Re-apply the
vendored version if that happens. The workflows under `.github/` still use
`jq` freely — GitHub's runners ship it, and that is not a contributor's
machine.

`FALLOW_AUDIT_BASE` is pinned to `origin/main` in `.claude/settings.json`. Left unset, the audit takes its base from the merge-base with the branch's UPSTREAM, which is the remote tracking branch — stale on any branch whose local commits are not pushed, and after a rebase that means the diff carries every commit `main` gained since. Measured here: 319 changed files and a `fail` verdict on a branch whose actual diff was nine commits. Every pull request in this repo targets `main`, so naming it removes the guesswork.

For non-skill agents, treat the task map below as the local onboarding source: run the listed fallow command before destructive edits, before commits, and before pull request handoff.

## Fallow task map

| When the agent is about to...                                     | Run                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`                                           |
| prove a TypeScript symbol's exact consumers before refactoring    | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>`      |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>`                                         |
| commit or open a PR                                               | `pnpm fallow:audit` (`fallow audit --base origin/main`)                              |
| prioritize refactoring                                            | `fallow health --hotspots --targets`                                                 |
| ask who owns code                                                 | `fallow health --ownership`                                                          |
| check untested-but-reachable code                                 | `fallow health --coverage-gaps`                                                      |
| consolidate duplication                                           | `fallow dupes --trace dup:<fingerprint>`                                             |
| find feature flags                                                | `fallow flags`                                                                       |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                                                               |
| surface security candidates                                       | `fallow security`                                                                    |
| understand a finding                                              | `fallow explain <issue-type>`                                                        |
| scope a monorepo                                                  | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |

<!-- fallow:setup-hooks:end -->
