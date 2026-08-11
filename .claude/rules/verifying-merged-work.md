---
paths:
  - "**/*"
---

## A squash merge makes every ancestry check unsound

Merging squashes the branch into one new commit, so the branch head is **never**
an ancestor of `main`. `git branch --merged`, `git log | grep <sha>` and "is
this commit in main" therefore answer confidently and wrongly. Verify by
CONTENT.

**Which marker you grep for is load-bearing, because this failure has a shape:
the lost commits are always at the TAIL.** It happens when commits land on the
branch after GitHub computed the merge, or when the merge runs from a stale
head — so you lose the end of the branch, never the middle. A marker taken from
an early or middle commit passes cleanly on a PR that dropped its last three.

1. Take a marker string from the **final** commit on the branch.
2. Confirm what was actually merged:
   `gh pr view N --json headRefOid,mergeCommit`
3. Grep `main` for that marker.

The danger window is push-a-fix-then-merge-immediately, which is what everyone
does once CI is green and threads are cleared. A PR has already merged here
missing its last commit, reading as complete with every thread resolved.

## Before calling a red run flake, name the mechanism

A green re-run answers "is this deterministic?". It does NOT answer "is the
cause gone?" — a failure with a conditional trigger passes whenever the
condition happens not to hold, and reads exactly like flake.

State the mechanism that would make it intermittent, and prefer evidence that
does not depend on a second run:

- **Legitimate:** a wall-clock ratio assertion on a machine running several
  test matrices at once measures load, not code.
- **Legitimate:** the diff never reached the failing subsystem, so it could not
  have caused it. **Unreachability is what exonerates a PR, not the re-run** —
  and that argument holds whether or not the second run is green.
- **Not sufficient:** "it passed the second time."

## Environment states wear the costume of code defects

After a rebase onto a moved `main`, a package you never touched failing to
resolve (`Cannot find module ...`) is a stale install. Run
`pnpm install --frozen-lockfile` in that worktree before diagnosing anything.

Related, and cheap to get wrong:

- **Run gates from the worktree ROOT.** From a package directory,
  `pnpm check-types --force` becomes a bare `tsc --force` and fails on the flag.
- **`pnpm lint` fails on a WARNING** (`--max-warnings 0`), and the pre-push hook
  runs it, so the failure arrives after the commit exists. Check by exit code;
  the log says "0 errors, 1 warning" and still fails.
- **Never run a unit suite while an integration leg is in flight.** Unrelated
  files time out and read like a broad regression.
- **Never work a PR branch in the shared checkout.** Use `git worktree add`;
  another session switching branches underneath you removes files mid-command.
