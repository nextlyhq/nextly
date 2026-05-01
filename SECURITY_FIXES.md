# Nextly — Security Fixes Execution Plan

> **Source of findings:** [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
> **Status:** Ready for Phase 1 execution
> **Last updated:** 2026-04-28

This document is the day-to-day execution tracker for security audit findings. It does **not** duplicate the audit — for the _why_ behind each task, click through to the audit. This doc adds the things you need to actually start work without surprises: stable task IDs, ordering, parallel swimlanes, verification commands, breaking-change handling, and PR conventions.

---

## Status overview

> **Last updated:** 2026-05-01 — keep this block in sync when any task status changes.

| Phase                  | Done | In review | Claimed | Blocked | Pending |
| ---------------------- | ---- | --------- | ------- | ------- | ------- |
| 1 — Pre-beta           | 14   | 0         | 0       | 0       | 0       |
| 2 — Pre-1.0            | 0    | 0         | 0       | 0       | 14      |
| 3 — Roadmap (post-1.0) | 0    | 0         | 0       | 0       | 11      |

**Status values per task:** `pending` → `claimed: <name>` → `done (<short-sha>)`. Use `blocked: <reason>` if a dependency is unmet.

**Phase-level status** (informal, tracked separately): `kickoff` → `in-progress` → `in-review (#PR)` → `released (#PR)`. The phase as a whole gets one PR at the end; per-task PRs don't exist in this model.

**How to pick up a task:**

1. Find the first `pending` task in your lane (see _Phase 1 suggested execution order_ / _Phase 2 suggested order_).
2. Verify any **Blocked by** task is already `done (<sha>)`.
3. Set the task's `**Status:**` to `claimed: your-name`. Bump _Claimed_, decrement _Pending_. Push the claim commit immediately if you might pause the task before finishing.
4. After your implementation commit lands on `security/phase-N`: flip the status to `done (<short-sha>)`, decrement _Claimed_, increment _Done_.

---

## Contents

- [Status overview](#status-overview)
- [How to use this doc](#how-to-use-this-doc)
- [Cross-cutting conventions](#cross-cutting-conventions)
- [Phase 1 — Pre-beta](#phase-1--pre-beta)
- [Phase 2 — Pre-1.0](#phase-2--pre-10)
- [Phase 3 — Roadmap (post-1.0)](#phase-3--roadmap-post-10)
- [Bundling opportunities](#bundling-opportunities)
- [Open questions before kickoff](#open-questions-before-kickoff)

---

## How to use this doc

- **Stable IDs**: Every task has a `T-NNN` ID. Use it in commit messages, branch names, PR titles, and changesets. Audit IDs (C1, H1, M19, …) are kept as cross-references only.
- **Ordering**: Each phase has a "Suggested execution order" with parallel swimlanes. Pick the first task in any lane that doesn't have an unmet **Blocked by**.
- **Effort key**: **S** ≈ 1–2 hours · **M** ≈ half-day to a day · **L** ≈ multi-day.
- **Breaking changes**: Tasks tagged 🔥 **BREAKING** require the rollout pattern below. For beta scope, breaking-direct may be acceptable — confirm per-task in the rollout note.
- **Tests policy**: Run the existing suite (`pnpm test`, `pnpm test:integration:*`, `pnpm test:e2e`). **Do not add new test files** — verification uses existing tests + manual checks called out per task.

---

## Cross-cutting conventions

### Branching model — phase as a single PR

One long-lived branch per phase. Each task is a **commit** on that branch (not a separate PR). The phase ships as **one PR** to `dev` once all task commits are in.

```
dev
 └─ security/phase-N           ← long-lived phase branch (from dev)
       │
       ├─ commit: security(T-001): Postgres TLS reject-unauthorized default
       ├─ commit: security(T-002): S3 ACL private-by-default
       ├─ commit: security(T-003): default-deny on collection access
       ├─ ... (one commit per task; ~14 commits per phase)
       │
       └─ when phase complete:
             PR security/phase-N → dev   (merge, NOT squash — preserve commits)
```

**Total PR count:** 2 — one per phase. Phase 3 (post-1.0 roadmap) uses the regular feature workflow, not this model.

### Branch lifecycle

| Branch                    | Created when                    | Branched from | PRs into             | Merge style                                   | Lifetime   |
| ------------------------- | ------------------------------- | ------------- | -------------------- | --------------------------------------------- | ---------- |
| `security/phase-N`        | Phase kickoff (once)            | `dev`         | `dev` (at phase end) | `--merge` (preserves task commits for bisect) | Days–weeks |
| `hotfix/T-NNN-short-slug` | Critical fix to released `main` | `main`        | `main`               | `--squash --delete-branch`                    | Hours      |

No per-task branches. No per-task PRs. Tasks are commits.

### Conventions

| Element                        | Format                                            | Example                                                      |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------ |
| Phase branch                   | `security/phase-N`                                | `security/phase-1`                                           |
| Task commit subject            | `security(T-NNN): <subject>`                      | `security(T-001): default rejectUnauthorized to true`        |
| Bundled commit                 | `security(T-NNN+T-MMM): ...`                      | `security(T-001+T-007): tighten TLS defaults`                |
| Status-claim commit (optional) | `chore(security): claim T-NNN`                    | —                                                            |
| Phase PR title                 | `Security Phase N: <theme> (T-NNN through T-MMM)` | `Security Phase 1: Pre-beta hardening (T-001 through T-014)` |
| Changeset                      | One per breaking task; small fixes can group      | committed alongside the task                                 |

### Phase kickoff (first dev, once per phase)

```bash
git checkout dev && git pull origin dev
git checkout -b security/phase-1
git push -u origin security/phase-1
```

Confirm phase entry criteria are met (baseline green, this doc signed off, _Open questions_ answered, changeset infra works) before starting the first task.

### Per-task workflow (no per-task branch, no per-task PR)

```bash
# Pull the phase branch
git fetch origin
git checkout security/phase-1 && git pull origin security/phase-1

# 1) Claim the task (status flip, optional separate commit)
# Edit SECURITY_FIXES.md: T-NNN status → `claimed: <name>`; bump overview counts.
git add SECURITY_FIXES.md
git commit -m "chore(security): claim T-NNN"
git push

# 2) Implement the fix per the T-NNN spec.

# 3) Verify (run the task's Verify commands).
pnpm test && pnpm check-types && pnpm lint && pnpm audit

# 4) Flip status to done and commit the implementation.
# Edit SECURITY_FIXES.md: T-NNN status → `done (<short-sha-after-commit>)`; shift overview counts.
git add .
git commit -m "security(T-NNN): <Title from task spec>"
git push

# 5) (For breaking tasks) add a changeset entry in the same commit or a follow-up.
```

The claim commit is optional — you can fold it into the implementation commit if you start and finish in the same session. The implementation commit is the canonical record of the task.

### Phase finalization (last task done)

```bash
git checkout security/phase-1 && git pull origin security/phase-1
git fetch origin
git rebase origin/dev          # bring in any unrelated dev advances since kickoff

# Full verification on the integrated phase branch
pnpm test && pnpm check-types && pnpm lint && pnpm audit
git push --force-with-lease

# Single phase PR — the only PR for the entire phase
gh pr create --base dev \
  --title "Security Phase 1: Pre-beta hardening (T-001 through T-014)" \
  --body "<phase summary, all 14 task IDs with one-line outcome each, breaking-change rollup, link to migration guide>"

# Merge with --merge (NOT squash) — preserve per-task commits on dev for bisect
gh pr merge --merge --delete-branch
```

After merge: `dev` tagged `vX.Y.Z-beta.M`. Phase complete.

### Code review approach

The phase PR is large (~14 commits). Three review modes work:

- **Commit-by-commit walk** (recommended): the reviewer steps through the PR commit list one at a time. Each commit = one task, fully scoped, with `security(T-NNN):` subject. Same review granularity as per-task PRs, just inside one PR.
- **Pre-review on push**: as commits land on `security/phase-N`, the maintainer reviews them inline (via `git log`, IDE, or local checkout) and signals approval informally before the phase PR opens.
- **Self-review for solo work**: with one dev, careful per-task verification before each commit + a final pass on the phase PR's commit list is sufficient.

### Six scenarios resolved

| #   | Scenario                            | Resolution                                                                                                                                                                                                           |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two devs both want T-001            | First to push `chore(security): claim T-001` wins. Second pulls, sees the claim, picks the next `pending` task.                                                                                                      |
| 2   | T-015 blocked by T-005              | T-015 is in Phase 2; can't even start until Phase 1's PR has merged to `dev` (since Phase 2 branches from `dev`). T-005's commit must land on `security/phase-1` and ship via the phase PR before T-015 work begins. |
| 3   | `dev` advances during the phase     | Rebase `security/phase-1` on `dev` weekly. Force-push with `--force-with-lease`. Note rebase in the phase PR body.                                                                                                   |
| 4   | Two devs commit concurrently        | First push wins. Second runs `git pull --rebase origin security/phase-N` and replays their commit on top.                                                                                                            |
| 5   | A task commit breaks a later task   | `git revert <sha>` on the phase branch — a new commit. Don't `git reset` the shared phase branch. The audit trail stays clean.                                                                                       |
| 6   | Hotfix to released `main` mid-phase | `hotfix/T-NNN-...` from `main` → PR to `main`. Cherry-pick the fix into `dev` and `security/phase-N` afterward.                                                                                                      |

### Pre-merge checklist (every security PR)

- [ ] `pnpm test` green
- [ ] `pnpm test:integration:postgres17` green (where DB-related)
- [ ] `pnpm check-types` green
- [ ] `pnpm lint` green
- [ ] `pnpm audit` shows no new advisories
- [ ] Manual verification per the task's **Verify** block
- [ ] Linked to audit finding ID(s) in PR description
- [ ] No new test files added (project policy)
- [ ] No secrets in diff (`git diff --cached | grep -iE 'secret|password|token|key'` reviewed)
- [ ] If 🔥 BREAKING: changeset entry + migration note in `docs/migration/`

### Breaking-change rollout pattern

Default for non-beta scope:

1. Land the new behavior **behind an opt-in flag**. Default still old. (PR 1)
2. Add migration note in `docs/migration/<release>.md`.
3. After ≥1 minor release: flip the default; opt-out preserves the old behavior. (PR 2)
4. Two minor releases later: remove the opt-out. (PR 3)

**Beta scope (current):** many "breaking" items can land directly with the new default — flag in changeset as a beta-period intentional break. **Confirm per-task** in the rollout note.

### Verification commands cheat-sheet

```bash
# Full suite
pnpm test
pnpm check-types
pnpm lint

# DB integration variants
pnpm test:integration:postgres15
pnpm test:integration:postgres17
pnpm test:integration:mysql
pnpm test:integration:sqlite

# Auth e2e
pnpm --filter auth-e2e test

# Vulnerability scan
pnpm audit

# Run dev to manually test
pnpm dev:core      # framework
pnpm dev:admin     # admin UI
pnpm dev:app       # playground
```

---

## Phase 1 — Pre-beta

**Goal:** No Critical or "easy" High remains open before public beta announcement.
**Estimated effort:** 1 engineer × ~3 working days, or 2 engineers × ~1.5 days using parallel lanes.

### Phase 1 entry criteria

- This document reviewed and signed off by the maintainer.
- `dev` branch baseline green for `pnpm test`, `pnpm check-types`, `pnpm lint`.
- Changeset infrastructure ready (existing — confirm `pnpm changeset` works).
- **Phase branch `security/phase-1` created from `dev` and pushed** (see [Phase kickoff](#phase-kickoff-first-dev-once-per-phase)).
- _Open questions_ below all answered by maintainer.

### Phase 1 exit criteria

- All 14 Phase-1 task commits landed on `security/phase-1` (each with `security(T-NNN):` subject; each task's `**Status:**` updated to `done (<sha>)`).
- `security/phase-1` rebased on latest `dev`; `pnpm test && pnpm check-types && pnpm lint && pnpm audit` all green on the integrated branch.
- Manual re-run of audit R2 verification questions confirms findings closed.
- T-009 (SECURITY.md hardening) committed.
- **Phase PR (`security/phase-1` → `dev`) merged with `--merge` (preserving per-task commits)**.
- Beta-blocker checklist in [SECURITY_AUDIT.md](SECURITY_AUDIT.md) recommendation table all ticked.

### Suggested execution order

Three parallel lanes. Pick the first task in any lane that has no unmet blocker.

| Lane                                            | Tasks                                 | Theme                                                                                                     |
| ----------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A** — Defaults + docs (low risk, fast)        | T-001 → T-002 → T-007 → T-013 → T-009 | Config flips and the SECURITY.md rewrite                                                                  |
| **B** — Helpers + auth flows                    | T-005 → T-008 → T-011 → T-010         | Build the trust-proxy + URL-validation helpers, then auth-flow fixes that need the helper or are isolated |
| **C** — Access + uploads (highest blast radius) | T-003 → T-004 → T-012 → T-014 → T-006 | Default-deny, Direct-API isolation, body caps, LIKE escape, upload validation                             |

Tasks within a lane are roughly serial; tasks across lanes are parallel-safe.

---

### T-001 · Postgres TLS reject-unauthorized default

- **Audit ref:** C1 · **Lane:** A · **Effort:** S · **Type:** config · 🔥 BREAKING (silent)
- **Files:** [packages/adapter-postgres/src/index.ts:774](packages/adapter-postgres/src/index.ts#L774)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`10e4d90`)

**Fix:** Remove the silent `ssl = { rejectUnauthorized: false }` fallback. When provider auto-detection requires SSL but no user config exists, default to `{ rejectUnauthorized: true }`. Keep an explicit opt-out path (`ssl: { rejectUnauthorized: false }` in user config) but emit a `console.warn` when it's used.

**Verify:**

```bash
# Should pass — none of the existing tests should depend on insecure SSL
pnpm test:integration:postgres17

# Manual: connect to a self-signed-cert local Postgres with default config
# Expected: clear cert-validation error at connection time, not a silent connect.
```

**Rollout note (beta):** Direct flip is acceptable — anyone connecting to Neon/Supabase with valid certs is unaffected. Document in changeset: "Postgres adapter no longer silently disables certificate validation. Set `ssl: { rejectUnauthorized: false }` explicitly if your provider uses untrusted certs."

---

### T-002 · S3 ACL private-by-default

- **Audit ref:** C2 · **Lane:** A · **Effort:** S · **Type:** config · 🔥 BREAKING
- **Files:** [packages/storage-s3/src/adapter.ts:116](packages/storage-s3/src/adapter.ts#L116)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`1ebea04`)

**Fix:** `acl: config.acl ?? "private"`. Update [packages/storage-s3/README.md](packages/storage-s3/README.md) and the playground example to set `acl: "public-read"` explicitly when public buckets are intended. Add a short migration note explaining when to flip ACL vs use signed URLs.

**Verify:**

```bash
pnpm test --filter @nextly/storage-s3
# Manual: upload via playground, verify default ACL is private (object URL returns 403 unsigned).
```

**Rollout note (beta):** Direct flip. Changeset: "S3 storage adapter now defaults uploads to `private`. Set `acl: 'public-read'` explicitly for public buckets, or use signed URLs (preferred)."

---

### T-003 · Default-deny on collection access

- **Audit ref:** C6 · **Lane:** C · **Effort:** M · **Type:** behavior · 🔥 BREAKING
- **Files:** [packages/nextly/src/services/access/access-control-service.ts:198-210](packages/nextly/src/services/access/access-control-service.ts#L198-L210)
- **Blocked by:** —
- **Blocks:** Templates / quickstart need updating in same PR.
- **Status:** done (`5c24cbe`)

**Fix (decision R5: default-deny):**

1. Change the access-control fallback at [access-control-service.ts:198-210](packages/nextly/src/services/access/access-control-service.ts#L198-L210) from `if (!rule) return { allowed: true };` to `if (!rule) return { allowed: false };`.
2. Update `templates/base`, `templates/blank`, `templates/blog`, and `apps/playground` so every registered collection has explicit `access` rules — typically `access: { read: 'public' }` for content collections, stricter for `users`/`media`/etc. Same PR.
3. Update the quickstart docs (`docs/getting-started/*`) to show explicit `access` rules in the first-collection example. Add a "Default-deny access" callout.
4. Verify `pnpm dev:app` still works end-to-end after templates are updated — collections that should be public still are; ones that shouldn't return 403.

**Verify:**

```bash
pnpm test
pnpm dev:app  # playground end-to-end smoke test
# Manual:
#   1) Add a new collection with NO access config to a fresh template clone.
#      Hit the auto-generated REST endpoint. Expected: 403.
#   2) Add `access: { read: 'public' }` to that collection.
#      Hit again. Expected: 200.
```

**Rollout note (beta, decision R5: flip directly):** Direct flip in Phase 1 — no opt-in flag intermediate step. Flag this in the changeset as the most user-impacting change in the audit, with a one-line migration note: "All collections now require explicit `access` rules; add `access: { read: 'public' }` (or stricter) to every collection definition."

---

### T-004 · Direct API server-only enforcement

- **Audit ref:** C7 · **Lane:** C · **Effort:** M · **Type:** safety hardening
- **Files:** [packages/nextly/src/services/lib/permissions.ts:11-15](packages/nextly/src/services/lib/permissions.ts#L11-L15), [packages/nextly/src/nextly.ts:252](packages/nextly/src/nextly.ts#L252), [packages/client/package.json](packages/client/package.json)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`2940662`)

**Fix:**

1. Replace the try/catch'd dynamic `import("server-only")` with a top-of-file `import "server-only";` (no try, no catch — let the bundler error).
2. Add at module init: `if (typeof window !== "undefined") throw new Error("Direct API is server-only — do not import from client components");`.
3. Update `packages/client/package.json` `exports` to mark Direct API entry as Node-conditioned (no `"browser"` export, `"node"` only).
4. Add a small Node script (not a test file) at `scripts/verify-server-only.mjs` that imports the package with `globalThis.window = {}` set and asserts the import throws — wire into CI.

**Verify:**

```bash
pnpm test
pnpm --filter playground build  # must still build (server-only used correctly)
node scripts/verify-server-only.mjs  # must exit 0 on the throw
```

**Rollout note (beta):** Non-breaking for correctly-used setups (Direct API was always meant for server components). If a user was accidentally bundling it client-side, their build will now fail loudly — that is the desired outcome.

---

### T-005 · X-Forwarded-For trust gate + shared helper

- **Audit ref:** C4 · **Lane:** B · **Effort:** M · **Type:** security helper
- **Files:** [packages/nextly/src/middleware/rate-limit.ts:318-339](packages/nextly/src/middleware/rate-limit.ts#L318-L339), [packages/nextly/src/auth/handlers/handler-utils.ts:66-68](packages/nextly/src/auth/handlers/handler-utils.ts#L66-L68); new helper at `packages/nextly/src/utils/get-trusted-client-ip.ts`.
- **Blocked by:** —
- **Blocks:** T-015 (refresh binding), T-016 (per-IP rate limit) — both Phase 2.
- **Status:** done (`72db96f`)

**Fix:**

1. New `getTrustedClientIp(request)` helper:
   - Reads `trustProxy: boolean` config from `nextly.config.ts` (default `false`).
   - Reads `TRUSTED_PROXY_IPS` env var (comma-separated CIDR list, default empty).
   - When `trustProxy: true` AND immediate peer is on the trust list, parse `X-Forwarded-For` and return the **rightmost-untrusted** hop.
   - Otherwise, ignore proxy headers entirely and fall back to direct connection IP (or `null`).
2. Replace both existing `getClientIp` implementations with the new helper.
3. Document the config in the docs site.

**Verify:**

```bash
pnpm test
pnpm --filter auth-e2e test

# Manual:
# 1. With trustProxy: false (default), curl with `X-Forwarded-For: 1.2.3.4` → server records actual peer IP, not 1.2.3.4.
# 2. With trustProxy: true and TRUSTED_PROXY_IPS set, the same header is honored.
```

**Rollout note (beta):** Non-breaking — defaults to ignoring XFF, which is the safer behavior. Anyone running behind a reverse proxy needs to set `trustProxy: true` explicitly. Flag this in the migration note.

---

### T-006 · Upload extension + magic-byte validation

- **Audit ref:** C5 · **Lane:** C · **Effort:** M · **Type:** security
- **Files:** [packages/nextly/src/services/upload-service.ts:483-515](packages/nextly/src/services/upload-service.ts#L483-L515); add `file-type` and `isomorphic-dompurify` to `packages/nextly/package.json`.
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`225fd91`)

**Fix (decision R5: sanitize SVG with DOMPurify):**

1. Add an extension blocklist constant for executable / script-bearing types: `html, htm, xhtml, xht, shtml, xml, php, php3, php4, php5, phtml, asp, aspx, jsp, jspx, exe, dll, sh, bat, cmd, com, scr, vbs, js, msi, pif, cpl, hta`. SVG is **allowed** but processed (next step).
2. Use the `file-type` library to read magic bytes from the buffer; reject when detected MIME doesn't match the client-claimed Content-Type (rejects polyglots and forged extensions).
3. **SVG handling — DOMPurify sanitize on upload:**
   - Detect `image/svg+xml` MIME (or `.svg`/`.svgz` extension after magic-byte verification).
   - Decompress `.svgz` (gzip) to `.svg` first.
   - Run the SVG content through `DOMPurify.sanitize()` with the SVG profile (`USE_PROFILES: { svg: true, svgFilters: true }`). This strips `<script>`, `onerror`, `onload`, `javascript:` URLs, foreign `<iframe>` etc.
   - Store the sanitized SVG (not the original).
   - For Vercel Blob (T-013) and any storage adapter that can't enforce attachment-disposition: still hard-reject SVG (sanitization is defense-in-depth, attachment-disposition is the platform-level guard; Vercel can't do either reliably).
4. Reject filenames containing null bytes, leading dots only, or path separators after the existing sanitization.

**Verify:**

```bash
pnpm test
# Manual:
# 1. curl -F 'file=@/tmp/evil.html;type=image/jpeg' http://localhost:3000/api/uploads
#    → 400 (extension blocklist + magic-byte mismatch)
# 2. cat > /tmp/evil.svg <<'EOF'
#    <svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="50"/></svg>
#    EOF
#    Upload via S3 adapter → succeeds; download → <script> tag is gone, circle remains.
# 3. Upload same SVG via Vercel Blob adapter → 400 (T-013 hard-reject).
```

**Rollout note (beta, decision R5: flip directly):** Changeset: "Upload validation now (a) checks extension + magic bytes against an executable-type blocklist; (b) sanitizes SVG content with DOMPurify on upload before storing; (c) Vercel Blob adapter rejects SVG/HTML entirely (the platform can't enforce safe-serving headers)."

---

### T-007 · SMTP secure default

- **Audit ref:** H7 · **Lane:** A · **Effort:** S · **Type:** config · 🔥 BREAKING (silent)
- **Files:** [packages/nextly/src/domains/email/services/providers/smtp-provider.ts:58-66](packages/nextly/src/domains/email/services/providers/smtp-provider.ts#L58-L66)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`7a118e9`)

**Fix:** Default `secure: true`. Add startup validation: if `host` is not localhost AND `secure: false` AND port ≠ 587 (STARTTLS), throw with a clear message pointing at the SMTP docs.

**Verify:**

```bash
pnpm test
# Manual: configure SMTP with host=remote, secure=false, port=25 → expected: throws at startup.
# host=remote, secure=false, port=587 (STARTTLS) → expected: works.
```

**Rollout note (beta):** Direct. Changeset: "SMTP `secure` now defaults to `true`. Use port 587 with STARTTLS or set `secure: false` explicitly for legacy plaintext-on-localhost setups."

---

### T-008 · Shared `validateExternalUrl` helper (closes H8 + C3)

- **Audit ref:** H8, C3 · **Lane:** B · **Effort:** M · **Type:** security helper
- **Files:** [packages/plugin-form-builder/src/handlers/webhooks.ts:414-428](packages/plugin-form-builder/src/handlers/webhooks.ts#L414-L428), [packages/nextly/src/di/registrations/register-email.ts:68-88](packages/nextly/src/di/registrations/register-email.ts#L68-L88), new `packages/nextly/src/utils/validate-external-url.ts`.
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`25b63ba`)

**Fix:** New `validateExternalUrl(url, opts?)` helper:

1. Parse URL; require `https:` (or `http://localhost`/`127.0.0.1` only when `opts.allowLocalhost` is true).
2. `dns.lookup(host, { all: true })` → reject if any returned IP is RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1), link-local (169.254/16, fe80::/10), CGNAT (100.64/10), `0.0.0.0`/`::`, or known cloud-metadata IPs (`169.254.169.254`, `169.254.169.253`).
3. Pin the validated IP for the actual fetch (use a custom https.Agent with `lookup: () => validatedIp`) to defend against DNS rebinding.
4. Replace the webhook validator and the email-attachment fetcher with calls to this helper.

**Verify:**

```bash
pnpm test
# Manual:
# curl webhook config with URL https://[::1]:8000 → rejected
# curl webhook config with URL https://10.0.0.1 → rejected
# curl webhook config with URL https://example.com → accepted
# Email attachment: storagePath = "https://169.254.169.254/latest/meta-data/" → rejected
```

**Rollout note (beta):** Non-breaking for legitimate users. Closes both H8 and C3 in a single PR.

---

### T-009 · SECURITY.md + GitHub Advisories

- **Audit ref:** H10 · **Lane:** A · **Effort:** S · **Type:** docs + repo settings
- **Files:** [SECURITY.md](SECURITY.md); GitHub repo settings (Security & analysis)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`e2fc006`)

**Fix (decision R5: GitHub Private Vulnerability Reporting, no PGP):**

1. **Enable Private Vulnerability Reporting** on the GitHub repo:
   - Settings → Code security and analysis → check **"Private vulnerability reporting"**.
   - This adds a "Report a vulnerability" button to the repo's Security tab.
   - One-time, ~30 seconds. No CLI step required.

2. **Rewrite `SECURITY.md`** to include all of the following:
   - **Primary intake (preferred):** point researchers at GitHub's "Report a vulnerability" button on the repo's Security tab. Link directly: `https://github.com/<org>/<repo>/security/advisories/new`.
   - **Backup contact:** `security@nextlyhq.com` for researchers without GitHub accounts. Note that backup reports may be slower to process.
   - **Response SLA:** acknowledge within 48 hours. Critical patched within 7 days; High within 14 days; Medium/Low within 30 days. Best-effort, not contractual.
   - **Severity matrix:**
     - **Critical** — RCE, authentication bypass, data exfiltration without auth, supply-chain compromise.
     - **High** — privilege escalation, data exposure with auth, persistent XSS in admin, SSRF to internal network.
     - **Medium** — information disclosure, DoS, reflected XSS, CSRF on non-state-changing endpoints.
     - **Low** — security headers missing, weak defaults that require active misuse to exploit, defense-in-depth gaps.
   - **Scope (in scope):** all packages under `packages/*` of the Nextly monorepo. Currently supported: `0.x` series (beta).
   - **Out of scope:** dependency CVEs without proof of new framework impact (cite Strapi's exclusions doc), unsupported versions, intentional misconfiguration, social engineering, denial of service via resource exhaustion that's bounded by config.
   - **Disclosure timeline:** 90-day standard from acknowledgement to public advisory. Embargo extendable by mutual agreement if a fix is complex.
   - **Credit:** reporters credited in the GitHub advisory and CVE record (opt-in). No bug bounty program.
   - **What we will NOT do:** reward reports, accept reports via Discord/Slack/Twitter DMs (only the GitHub flow or `security@nextlyhq.com`).

3. **No PGP key.** GitHub's private vulnerability reporting handles encryption-equivalent privacy through the platform. The backup email is for researchers without GitHub accounts; if they want encryption on top, they can use ProtonMail/Tutanota themselves.

**Verify:**

- Repo Settings → Code security and analysis shows Private Vulnerability Reporting **enabled**.
- The repo's Security tab now has a "Report a vulnerability" button.
- `SECURITY.md` renders correctly on GitHub (preview the file).
- All sections present: intake, SLA, severity matrix, scope, exclusions, disclosure timeline, credit policy.
- A test report submitted via the button arrives privately to repo admins (only). No public visibility.

**Rollout note:** Pure docs + one repo-setting flip. Non-breaking.

---

### T-010 · Signup endpoint enumeration parity

- **Audit ref:** H11 · **Lane:** B · **Effort:** S · **Type:** auth fix
- **Files:** [packages/nextly/src/auth/handlers/register.ts:26-65](packages/nextly/src/auth/handlers/register.ts#L26-L65)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`137b962`)

**Fix:**

1. Wrap the handler with `stallResponse(startTime, deps.loginStallTimeMs)` exactly like `forgot-password` does.
2. Replace error message `"User with this email already exists"` with generic `"Check your email to complete registration"`.
3. For existing accounts: send an "you already have an account" email instead of returning a distinguishing error.

**Verify:**

```bash
pnpm --filter auth-e2e test
# Manual: time and body of POST /auth/register with a fresh email vs. an existing one — should be byte-identical and timing-equalized.
```

**Rollout note:** Non-breaking but changes UX — a duplicate-signup user no longer sees an error in the UI; instead they get an email. Mention in changeset.

---

### T-011 · Open redirect on `redirectPath`

- **Audit ref:** H2 · **Lane:** B · **Effort:** S · **Type:** auth fix
- **Files:** [packages/nextly/src/auth/handlers/forgot-password.ts:47-56](packages/nextly/src/auth/handlers/forgot-password.ts#L47-L56)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`e4eba99`)

**Fix:**

1. Validate `redirectPath` against (a) relative paths under `/admin` only, OR (b) `ALLOWED_REDIRECT_HOSTS` env allowlist.
2. On rejection: silently fall back to the default redirect (do **not** include the bad path in the email; do not error to the caller — that would defeat the existing enumeration protection).
3. Add a `console.warn` log so misconfigurations are visible.

**Verify:**

```bash
pnpm test
# Manual: POST /auth/forgot-password with redirectPath="https://attacker.example" → reset email contains the default redirect, not the bad one.
```

**Rollout note:** Non-breaking for legit users.

---

### T-012 · Body / multipart size caps via `nextly.config.ts`

- **Audit ref:** H13 · **Lane:** C · **Effort:** M · **Type:** config + DoS hardening
- **Files:** [packages/nextly/src/api/uploads.ts:272](packages/nextly/src/api/uploads.ts#L272), middleware, config schema in `packages/nextly/src/config/`
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`e1ebbba`)

**Fix:**

1. Add a `limits` block to the `nextly.config.ts` schema:
   ```ts
   limits?: {
     json?: string;        // default "1mb"
     multipart?: string;   // default "50mb"
     fileSize?: string;    // default "10mb"
     fileCount?: number;   // default 10
     fieldCount?: number;  // default 50
     fieldSize?: string;   // default "100kb"
   }
   ```
2. Implement a streaming size guard at the request layer that aborts above the configured `multipart` cap **before** the body is fully buffered.
3. Wire `fileSize`/`fileCount`/`fieldCount`/`fieldSize` into the multipart parser; reject early on overflow.
4. Document each knob in the config reference, including the trade-off (memory + DoS surface scales with `multipart`).

**Verify:**

```bash
pnpm test
# Manual:
# Without limits configured: POST /api/uploads with 500MB body → aborted before buffer.
# With limits.multipart: "200mb" in nextly.config.ts: 150MB upload succeeds, 250MB fails.
```

**Rollout note:** Non-breaking for users currently uploading <50MB. Anyone with larger uploads needs the new config knob — flag in changeset and migration note.

---

### T-013 · Reject SVG/HTML on Vercel Blob

- **Audit ref:** H14 · **Lane:** A · **Effort:** S · **Type:** safety
- **Files:** [packages/storage-vercel-blob/src/adapter.ts:106-117](packages/storage-vercel-blob/src/adapter.ts#L106-L117)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`013a583`)

**Fix:** Replace the one-time console warning with a thrown error for `image/svg+xml` and `text/html` uploads. Update the adapter README to explain the platform limitation and point to S3 as the alternative.

**Verify:**

```bash
pnpm test --filter @nextly/storage-vercel-blob
# Manual: upload an SVG via Vercel Blob adapter → throws with a clear message.
```

**Rollout note:** Direct. Changeset: "Vercel Blob adapter no longer accepts SVG/HTML uploads (the platform cannot enforce attachment-disposition, which makes them stored XSS). Use S3 with `Content-Disposition: attachment` for these types."

---

### T-014 · LIKE wildcard escape in where-filter operators

- **Audit ref:** H15 · **Lane:** C · **Effort:** S · **Type:** correctness
- **Files:** [packages/nextly/src/domains/collections/query/query-operators.ts:193-203](packages/nextly/src/domains/collections/query/query-operators.ts#L193-L203)
- **Blocked by:** —
- **Blocks:** —
- **Status:** done (`7c05fae`)

**Fix:** Mirror the escape logic that already exists correctly in `buildSearchCondition` ([collection-query-service.ts:1196-1237](packages/nextly/src/domains/collections/services/collection-query-service.ts#L1196-L1237)):

```typescript
const escaped = String(value)
  .replace(/\\/g, "\\\\")
  .replace(/%/g, "\\%")
  .replace(/_/g, "\\_");
const searchValue = `%${escaped}%`;
```

Backslash escape must come first.

**Verify:**

```bash
pnpm test
# Manual: where: { title: { like: "100%" } } → SQL bind value is %100\%% (escaped %)
# where: { title: { like: "_" } } → matches only literal underscore in titles, not "any character"
```

**Rollout note:** Could be subtly observable for users who relied on the unescaped wildcard behavior. Flag in changeset: "where-filter `like`/`contains`/`search` now treat `%` and `_` as literal characters. Use the search API for wildcard matching."

---

## Phase 2 — Pre-1.0

**Goal:** Close remaining Highs and the highest-leverage Mediums before the 1.0 cut.
**Estimated effort:** 1–2 weeks of engineering, partly parallelizable.

### Phase 2 entry criteria

- Phase 1 PR fully merged to `dev` and tagged for beta release.
- T-005 (XFF helper) commit on `dev` — required by T-015, T-016.
- T-008 (validateExternalUrl helper) commit on `dev` — already covers C3.
- **Phase branch `security/phase-2` created from `dev` and pushed** (see [Phase kickoff](#phase-kickoff-first-dev-once-per-phase)).

### Phase 2 exit criteria

- All 14 Phase-2 task commits landed on `security/phase-2` (each with `security(T-NNN):` subject; each task's `**Status:**` updated to `done (<sha>)`).
- `security/phase-2` rebased on latest `dev`; full verification green on the integrated branch.
- All remaining Highs closed.
- The 9 high-leverage Mediums (M3, M9, M10, M11, M13, M19, M21, M22, M23) closed.
- **Phase PR (`security/phase-2` → `dev`) merged with `--merge`**.
- `pnpm audit` clean on `dev`.

### Tasks

> **Test policy for T-019 and T-022 (R5 decision):** project policy is "no new test files." For these two tasks, **extending an existing `*.test.ts` with new `it()` blocks is acceptable** — the rule is about not creating new test files, not about leaving subsystems untested. For T-019 (encryption salt migration), add cases to whichever existing test file most directly exercises the encrypt/decrypt round-trip. For T-022 (audit log), add cases to whichever existing test file is closest to the auth handlers being instrumented. Confirm with the maintainer if no existing file is a clean fit before adding.

| ID        | Title                                        | Audit ref | Effort | Blocked by | Status  | Notes                                                                                                                                                          |
| --------- | -------------------------------------------- | --------- | ------ | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T-015** | Refresh-token UA/IP binding                  | H3        | S      | T-005      | pending | Compare stored UA/IP via `getTrustedClientIp`; soft-fail UA, hard-fail on IP-class change.                                                                     |
| **T-016** | Per-IP rate limit on auth endpoints          | H4        | M      | T-005      | pending | 30 req/IP/hr on `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`. Layer on top of per-user lockout.                            |
| **T-017** | ReDoS-safe regex via `re2`                   | H5        | S      | —          | pending | Replace `new RegExp(pattern)` validation with `safe-regex2`; use `re2` for runtime matching; cap pattern length ≤ 200.                                         |
| **T-018** | DDL escaping for dynamic schema              | H9        | M      | —          | pending | Regex CHECK: whitelist character set or parameterize via `~`/`REGEXP`. Column DEFAULT: literals + named-function allowlist only; reject free-form `sql` field. |
| **T-019** | Per-encryption random salt                   | H12       | M      | —          | pending | Random 16-byte salt per encryption. Format `salt.iv.authTag.ciphertext`. Migration: try new format, fall back to legacy salt, re-encrypt on next write.        |
| **T-020** | CSP defaults that work                       | M3        | S      | —          | pending | Replace `default-src 'none'` with admin-runnable defaults; document customization.                                                                             |
| **T-021** | Zod schema on `/auth/register`               | M9        | S      | —          | pending | Email format, password strength, name length checks at the route layer.                                                                                        |
| **T-022** | Audit log subsystem                          | M10       | L      | —          | pending | Log failed CSRF, failed login, password change, role assignment, user delete with timestamp/actor/IP/UA. Tamper-evident table or append-only file.             |
| **T-023** | Row-level ownership filter                   | M11       | M      | —          | pending | Enforce `owner-only` rules via WHERE clauses, not post-retrieval filtering. Row-scoped only — field-scoped is intentionally out of scope (former H6).          |
| **T-024** | Pre-commit secret scan                       | M13       | S      | —          | pending | Add `gitleaks` or `detect-secrets` to husky pre-commit + GitHub Action.                                                                                        |
| **T-025** | `Cache-Control: no-store` on auth            | M19       | S      | —          | pending | Patch `jsonResponse()` to default `no-store` when path matches `/auth/*`.                                                                                      |
| **T-026** | Query depth + pagination caps                | M21       | S      | —          | pending | Cap nesting depth (5), conditions per query (50), `limit` (200) in the parser. Make configurable.                                                              |
| **T-027** | Vercel Blob folder sanitization              | M22       | S      | —          | pending | Reject `..`, `/`, `\` in folder; same pattern as the (yet-to-be-fixed) S3 finding M5.                                                                          |
| **T-028** | UploadThing default `attachment` disposition | M23       | S      | —          | pending | Flip `contentDisposition` default in adapter from `inline` to `attachment`.                                                                                    |

### Phase 2 suggested order

Two parallel lanes:

| Lane                          | Tasks                                                 | Theme                                      |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| **D** — Auth + DoS hardening  | T-015 → T-016 → T-021 → T-025 → T-026 → T-022         | Builds on T-005, then expands to audit log |
| **E** — Schema + storage + CI | T-017 → T-018 → T-019 → T-027 → T-028 → T-020 → T-024 | Independent from Lane D                    |

T-022 (audit log) and T-019 (encryption salt migration) are the two L-effort items — start each early in their lane.

---

## Phase 3 — Roadmap (post-1.0)

Not blockers. Each unlocks a meaningful security or compliance posture.

| ID        | Title                                        | Notes                                                                                    |
| --------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **T-101** | MFA / TOTP                                   | TOTP secret generation, QR provisioning, recovery codes, ±30s window.                    |
| **T-102** | HIBP breach-list check                       | Async k-anonymity API call on registration + password change.                            |
| **T-103** | Password history                             | Reject reuse of last 3 hashed passwords.                                                 |
| **T-104** | Redis-backed rate limiter                    | Multi-instance / serverless support. Pluggable backend interface.                        |
| **T-105** | Signed `create-nextly-app` template tarballs | Closes M7.                                                                               |
| **T-106** | `eslint-plugin-security` rollout             | Closes L8.                                                                               |
| **T-107** | Threat-model document                        | Required for B2B sales (vs Payload).                                                     |
| **T-108** | Runtime IDOR fuzz suite                      | Catches T-023 regressions and the response-projection promise (former H6 accepted-risk). |
| **T-109** | `__Host-` cookie prefix                      | Browser-enforced binding to HTTPS + path + no-Domain.                                    |
| **T-110** | Backup encryption                            | Encrypt `docker:backup` output; key management docs.                                     |
| **T-111** | GDPR / RTBF path                             | Cascading delete or anonymization for "delete user".                                     |

---

## Bundling opportunities

Some tasks share files or themes — combining them in a single PR keeps churn low:

| Bundle                           | Tasks                                    | Rationale                                                                      |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| **Transport-default tightening** | T-001 + T-007 + (Phase 2) M17 MySQL warn | All change DB/SMTP TLS defaults; one changeset; one migration note.            |
| **Storage adapter hardening**    | T-002 + T-013 + T-027 + T-028            | All touch storage adapters with the same theme; consider one cross-package PR. |
| **External-URL safety**          | T-008 (covers H8 + C3)                   | Already bundled.                                                               |
| **Auth-endpoint hardening**      | T-010 + T-011 + T-025 (Phase 2)          | Same family of files; PR-friendly.                                             |

---

## Decisions record (R5 — 2026-04-28)

All pre-kickoff open questions resolved by the maintainer. Each decision is reflected inline in the relevant task spec; this section is the audit trail.

| #   | Question                                                                              | Decision                                                                                                                                                                              | Reflected in                                     |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | T-003 — collections locked or open by default?                                        | **Locked by default** (3a). New collections without explicit `access` rules return 403 on all operations. Templates and quickstart updated in same PR.                                | T-003 spec; templates updates in scope of T-003  |
| 2   | T-006 — SVG handling?                                                                 | **Sanitize with DOMPurify on upload.** Allow SVG uploads; clean `<script>`, `onerror`, etc. before storing. Vercel Blob still hard-rejects SVG (platform can't enforce safe-serving). | T-006 spec; T-013 unchanged                      |
| 3   | Breaking-change rollout — flip directly or behind a flag first?                       | **Flip directly.** No opt-in flag intermediate step. Beta is the right time. Each breaking task includes a one-line migration note in the changeset.                                  | T-001, T-002, T-003, T-007 specs; rollout notes  |
| 4   | Tracking surface — single doc or GitHub issues / Linear?                              | **This document only.** Status lives in `**Status:**` lines + the _Status overview_ block. No external tracker.                                                                       | _Status overview_ + per-task Status lines        |
| 5   | Test policy for T-019 / T-022 (significant new behavior, no existing tests cover it). | **Extend existing `*.test.ts` files with new `it()` blocks.** No new test files.                                                                                                      | Test-policy callout above the Phase 2 task table |
| 6   | T-009 — PGP key situation?                                                            | **Skip PGP. Use GitHub Private Vulnerability Reporting** (Strapi-style) plus a backup `security@nextlyhq.com` email. Modern standard, no key-management overhead.                     | T-009 spec (rewritten)                           |
