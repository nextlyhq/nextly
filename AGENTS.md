# Nextly Monorepo: Agent Guide

Nextly is an open-source, Next.js-native CMS and app framework. Users define
content schema in TypeScript (code-first) or visually (the Schema Builder), and
it runs inside their own Next.js app with their own database (Postgres, MySQL,
or SQLite via Drizzle ORM). This repository is the pnpm + Turborepo monorepo
for all published packages. Status: alpha, all packages version in lockstep.

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
- `packages/plugin-sdk` - the ONLY stable import surface for plugin authors.
- `packages/plugin-{form-builder,page-builder}` - first-party plugins.
- `packages/storage-{s3,vercel-blob,uploadthing}` - media storage adapters.
- `packages/create-nextly-app` - scaffolding CLI. Templates live in
  `/templates` (`base`, `blank`, `blog`, `plugin`).
- `packages/ui` - shared React components and the design-token theme.
- `apps/playground` - contributor dev harness (not published).
- `e2e/` - Playwright suite. `docs/` - user docs (MDX, deployed to
  nextlyhq.com/docs).

Before editing a package, read its README.md and check for a nested AGENTS.md.

## Setup and dev loop

- Requirements: Node >= 20, pnpm 9.0.0 (`packageManager` is pinned in
  `package.json`; Corepack enforces the exact version).
- Install: `pnpm install`.
- Dev harness: `pnpm dev:app` starts the playground on :3000 (SQLite by
  default; `pnpm dev:postgres` / `pnpm dev:mysql` for other dialects, with
  services from `pnpm docker:up`). It seeds a dev user and auto-logs-in to
  `/admin` (dev-only; the credentials are `dev@nextly.local` /
  `DevPassword123!`, and auto-login is hard-blocked in production).
- There is no `nextly dev` CLI command by design: user apps run plain
  `next dev`, and schema changes apply in-process via the HMR listener.

## Build and test (read this before running anything)

- `pnpm build` builds all packages (turbo, dependency order).
- `pnpm check-types` and `pnpm lint` do NOT need a build first. `pnpm test`
  does (turbo handles it when run from the root).
- CRITICAL: integration tests require built packages. Run them from the ROOT
  (`pnpm test:integration...`) so turbo builds first. Running
  `pnpm --filter nextly test:integration` on an unbuilt tree fails 60+ files
  with self-import errors that look real but are not.
- Integration tests self-skip when the dialect's URL is unset. Use the root
  scripts: `pnpm test:integration:postgres17` (localhost:5435),
  `:postgres15` (:5434), `:mysql` (:3307), `:sqlite` (no URL needed). Start
  the databases with `pnpm docker:test`. NEVER point a TEST\_\* URL at a
  database you did not create for the test run.
- Integration files in `packages/nextly` run sequentially on purpose
  (`fileParallelism: false`, single fork): system-table suites share fixed
  table names. Do not "fix" slow integration runs by re-enabling parallelism.
- E2E: the root `e2e/` package (Playwright) boots its own playground on :3100
  with a fresh SQLite database per run.
- Some unit suites have a known pre-existing failing baseline. NEVER add to
  it: run the tests for the area you touch before and after your change, and
  fix any new failure you introduce.
- A test is only evidence once you have seen it FAIL for the intended reason.
  Break the code, confirm the intended test fails, restore. After changing a
  test, re-run its break: a fix to the test is a change to the experiment.
  What counts as the intended failure depends on when the test runs:
  - A RUNTIME test that stops COMPILING proves nothing — the assertion never
    executed, so the red says only that the break was malformed.
  - A COMPILE-TIME contract test is the opposite case: compilation IS the
    mechanism. In `*.test-d.ts`, widening a type makes its `@ts-expect-error`
    unused and `check-types` fails for exactly the intended reason. Red is not
    the evidence though — the EXPECTED DIAGNOSTIC is. A typo, a bad import or
    an unrelated type error in the same file all stop compilation too, and
    prove nothing about the property.
  - `@ts-expect-error` is the sharp edge here, because it suppresses ANY error
    on the line that follows. A test asserting "this call is rejected" stays
    green once the code starts erroring for a different reason, and stays green
    after the original rejection stops happening. Assert the diagnostic where
    the tooling allows it; otherwise put the expected error code in a comment
    on the directive, so a drift is visible in review rather than silent.
  - The count must not drop by ACCIDENT: a suite that silently stopped being
    discovered reads as a pass, which is what that guards. Removing a test on
    purpose is a different act, sometimes correct (below), and the PR says
    which test went and why.
- Before you assert or measure, name the property that SEPARATES a correct
  implementation from the plausible broken one you are worried about, and check
  that it is the property you are about to test. A necessary-but-insufficient
  property returns green from both, and it does so carrying the authority of
  having been checked, which closes the question. Two worked examples, both real:
  - measuring whether an old database constraint could be DROPPED, when what
    decides the repair is whether the code can FIND it. Dropping succeeded, and
    the repair would still have skipped every database silently.
  - asserting a generated identifier is `length <= 63`, when a plain truncation
    is also 63 characters. The one test guarding the naming passed on the broken
    implementation; distinctness was the separating property.

  The operational form is to ask what ELSE would produce the same green. If
  anything other than the property under test does — a fixture that never
  reaches the mechanism, an unregistered type falling through to a default, an
  assertion satisfied by absence, a search whose glob missed the directory —
  the property is not covered yet. Add the positive control that makes the
  mechanism's presence observable, and run it.

- Whatever you are currently judging WITH is not being judged. A probe, a
  derived check, a test, a post-apply verifier and the baseline diff that reads
  the suite all had the same defect in one week here, and every one of them
  existed to catch the layer above it. They were hard to see not because the
  defect was subtle but because each occupied the position auditing is done
  from, so nothing stood further out to look at it. Periodically step out one
  level and give the instrument the same treatment as its subject: a positive
  control on an input where you know the answer, and where the answer is not
  "nothing". Confirming an instrument against a case that did not move cannot
  distinguish it from one that reports nothing under any circumstances.
- A test that passes both with and without the fix is worse than no test:
  the next reader takes the green as coverage. Delete it, and say in the file
  that remains where the behaviour IS covered. This is the deliberate removal
  the count rule above exempts, so state the drop rather than letting it look
  like a suite that went missing.

## Conventions (enforced; violations will be rejected in review)

- Conventional Commits, checked by commitlint (husky) and a PR-title check.
  Allowed PR scopes are package-based (`nextly`, `admin`, `ui`,
  `adapter-postgres`, `adapter-mysql`, `adapter-sqlite`, `adapter-drizzle`,
  `storage-s3`, `storage-vercel-blob`, `storage-uploadthing`,
  `plugin-form-builder`, `plugin-page-builder`, `plugin-seo`, `plugin-sdk`,
  `blocks-engine`, `blocks-react`,
  `create-nextly-app`, `eslint-config`, `prettier-config`, `tsconfig`,
  `telemetry`, `client`) plus `playground`, `root`, `ci`, `docs`, `deps`,
  `release`. Scope is optional; the subject must not start with an uppercase
  letter. Subsystem names are not valid scopes.
- Errors thrown inside `packages/nextly/**` use `NextlyError` (static
  factories: `notFound`, `forbidden`, `validation`, `conflict`, `duplicate`,
  `authRequired`, `invalidCredentials`, `rateLimited`, `internal`, ...), never
  bare `Error`. The admin package is exempt: it consumes the typed
  `{ error: { code, message, requestId, data? } }` envelope via
  `parseApiError`.
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
  every call whether or not it can ever reject, so put those behind the work
  they protect rather than in front of a hot path.
- Prefer a boundary the system cannot cross to a check that looks for crossings.
  A scan over syntax has an unbounded surface and can only ever be patched; a
  declared dependency graph, a type, or a manifest assertion is complete by
  construction. If a "must not reach X" rule can be expressed as "X is not a
  dependency", that is strictly stronger than any visitor.
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

## Git and PR rules

- Never commit directly to main. Branch, open a PR, request review.
- Do not add "Generated with Claude Code", Co-Authored-By AI trailers, or any
  other AI attribution to commits or PR bodies.
- Husky runs gitleaks + lint-staged on commit, commitlint on the message, and
  lint + build on push. Never bypass hooks with `--no-verify`; if a hook
  fails, fix the cause.
- Pre-existing lint or type failures may be left alone (mention them in the
  PR); introducing new ones is not acceptable.
