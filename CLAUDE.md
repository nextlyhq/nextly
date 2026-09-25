<!-- Generated from AGENTS.md by `pnpm instructions:sync`. Edit that file, never this one. -->

# Nextly Monorepo: Agent Guide

Nextly is an open-source, Next.js-native content platform: a CMS and a Visual
Page Builder. Users define
content schema in TypeScript (code-first) or visually (the Schema Builder), and
it runs inside their own Next.js app with their own database (Postgres, MySQL,
or SQLite via Drizzle ORM). This repository is the pnpm + Turborepo monorepo
for all published packages. Status: alpha, all packages version in lockstep.

Codex reads this file, and Claude Code reads `CLAUDE.md`, a copy of it that
`pnpm instructions:sync` writes beside every `AGENTS.md` and
`pnpm check:agent-contract` holds identical: edit this file, never the copy.
Each chain of these files, from the root down to a package, must fit in the
32 KiB Codex reads (`pnpm check:instruction-size`).

## Skills, and when to load one

Procedures live in `.agents/skills/` rather than here, because a procedure
needed once per task should not occupy context in every session. Codex reads
them there; Claude Code reads `.claude/skills/`, a generated copy that
`pnpm skills:sync` rewrites and `pnpm check:agent-contract` holds identical —
edit the skills, never the copy. This table is the router: an agent selects a
skill from its description, and the table is what survives a description that
underperforms. Load the skill BEFORE the act, not
after it goes wrong.

| Load this                     | When you are about to                                    |
| ----------------------------- | -------------------------------------------------------- |
| `testing-evidence`            | add, change, delete or judge a test                      |
| `writing-integration-tests`   | write or debug a `*.integration.test.ts`                 |
| `adding-a-field-type`         | add a field type to the catalog                          |
| `derived-checks`              | write or review a check, gate, probe or derived view     |
| `auditing-an-instrument`      | act on a clean, empty or surprising result from a check  |
| `reading-a-ci-verdict`        | read CI, check runs or a reviewer verdict                |
| `reviewing-a-pr`              | review a PR or answer review-bot findings                |
| `verifying-merged-work`       | confirm a change landed, or judge a red after a rebase   |
| `recovering-a-clobbered-file` | recover a file a whole-file write may have replaced      |
| `release-and-changesets`      | touch a changeset, a release or a new package name       |
| `running-builds-and-tests`    | build, typecheck, lint or run tests, or size a local run |
| `working-in-worktrees`        | create, work in or remove a worktree                     |
| `running-the-fallow-gate`     | commit, push, or act on a fallow or code-hygiene finding |

A rule both tools must hold in every session lives in this file, since only it
reaches both: the whole-file write rule below. `.claude/rules/` keeps the rule
Claude Code loads by path, `.claude/rules/integration-tests.md` for
`*.integration.test.ts`, and Codex reads the same rules as the
`writing-integration-tests` skill.

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
branches underneath you removes files mid-command. Use a worktree with a slot:
`pnpm worktree new <branch>` creates it and claims a slot of its own ports and
test database, and `pnpm worktree remove <branch>` gives them back. Remove it
when you are finished, since an abandoned checkout holds its slot. `git stash`
is per-clone, not per-worktree, so prefer a branch commit to a stash while
several sessions are live. The other commands, what a slot owns and why, and a
slot left RESERVED: the `working-in-worktrees` skill.

## Build and test (read this before running anything)

- `pnpm build` builds all packages (turbo, dependency order). `pnpm check-types`
  and `pnpm lint` BOTH need a build first: an unbuilt sibling's `dist` fails
  them workspace-wide, and a stale one makes type-aware lint rules report on
  your own expressions, with no tell in the message. Build before you believe
  any lint or type result. For one package, build it WITH its dependencies:
  `pnpm --filter <pkg>... build`, not `<pkg>^...`.
- Integration tests need built packages, so run them from the ROOT:
  `pnpm test:integration:postgres17`, `:postgres15`, `:mysql`, `:sqlite`. They
  self-skip when the dialect's URL is unset. Their databases are the
  containers in `docker-compose.test.yml`, which neither `pnpm docker:test`
  nor `pnpm docker:up` starts. NEVER point a TEST\_\* URL at a database you did
  not create for the run, and never re-enable integration parallelism.
- E2E: the root `e2e/` package (Playwright) boots its own playground on :3100
  with a fresh SQLite database per run.
- Some unit suites have a known pre-existing failing baseline. NEVER add to
  it: run the tests for the area you touch before and after your change, and
  fix any new failure you introduce.
- A test is only evidence once you have watched it FAIL for the intended
  reason: load the `testing-evidence` skill before adding, changing or judging
  a test.
- Why each of these holds, the container start commands, and the
  measurements: the `running-builds-and-tests` skill. Perishable numbers live
  in `AGENTS.measured.md`, generated by `node scripts/measure-facts.mjs`.

## How much of the machine a local gate may take

Every heavy command — `pnpm build`, `lint`, `check-types`, `test`,
`test:integration*`, `verify:pr`, `verify:full` — and `.husky/pre-push` run
through `scripts/bounded.mjs`. It sizes the run to the machine
(`pnpm local-limits` prints it) and lets ONE heavy run at a time use it across
every checkout; a second waits. Unbounded, turbo's 10 package tasks times
Vitest's one worker per core exhaust an ordinary machine, and the kernel's
answer is to kill processes. Override one command with
`NEXTLY_LOCAL_CONCURRENCY` and `NEXTLY_LOCAL_MAX_WORKERS`. A command run inside
one package (`pnpm --filter <pkg> test`) takes no slot, so there the rule is
yours to keep: never a unit suite while an integration leg is in flight. The
budget, the overrides and each operating system's caveats: the
`running-builds-and-tests` skill.

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
them back with their data, which is why the start commands in the
`running-builds-and-tests` skill are `start` rather than `compose up`.

## A whole-file write is a delete plus a create

`cat > f`, `>` and a full-file editor write all replace the file, and the risk
is the belief that it is new. Before writing a file blind, establish that the
path is absent — an explicit NOT FOUND; any other failure to read it aborts,
because a file you could not read is still one the shell will truncate.
Better, make the write itself refuse: `set -o noclobber; printf '%s' "$content" > path`
as ONE command (each tool call starts a fresh shell, with the option off), or
Node's `writeFileSync(path, data, { flag: "wx" })`, which throws `EEXIST`.
Both refuse through a symbolic link anywhere in the path, dangling or not;
`>|` opts out where overwriting is the intent. Under an editing tool that
requires a prior read, use it rather than the shell. Why, as measured, and how
to recover a file once it has been clobbered: the
`recovering-a-clobbered-file` skill.

## Git and PR rules

- Never commit directly to main. Branch, open a PR, request review.
- Do not add a "generated with" line naming an AI tool, an AI co-author
  trailer, or any other AI attribution to commits or PR bodies.
- Husky runs gitleaks + lint-staged on commit, commitlint on the message, and
  lint + build on push; a push that only deletes remote branches runs no gates.
  Never bypass hooks with `--no-verify`; if a hook fails, fix the cause.
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

Before any `git commit` or `git push`, run
`fallow audit --format json --quiet --explain --gate-marker agent`, with
`FALLOW_AUDIT_BASE=origin/main` (`.claude/settings.json` sets it for Claude
Code sessions). If the verdict is `fail`, fix the reported findings before
retrying; treat a JSON runtime error (`{ "error": true, ... }`) as
non-blocking. Only findings the change introduces decide the verdict. What CI
enforces, the degraded run that looks clean, the vendored hook, and which
fallow command to run before deleting an "unused" export, file or dependency:
the `running-the-fallow-gate` skill.

<!-- fallow:setup-hooks:end -->
