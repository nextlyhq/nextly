---
name: working-in-worktrees
description: Use before creating, working in or removing a git worktree of the Nextly monorepo, when picking ports or a test database for a second checkout, when pnpm worktree reports a RESERVED slot, or when several sessions share one clone.
---

# Working in several checkouts at once

AGENTS.md keeps the rule every session needs; this is the detail behind it,
moved here whole so it is read when a checkout is about to be made rather than
held in every session.

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
