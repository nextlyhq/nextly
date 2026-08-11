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

1. Confirm what was actually merged: `gh pr view N --json headRefOid,mergeCommit`.
2. Take the check from the **final** commit, in whichever direction it changed
   things. A marker only proves anything if it is UNIQUE to that commit and the
   search is SCOPED to the path it changed — a string that also occurs elsewhere
   answers the same way whether or not the commit landed:
   - it ADDED content → `git grep <marker> origin/main -- <path>`; expect a hit.
   - it only REMOVED content → same command; expect NO hit. Grepping for ADDED
     text here finds nothing whether or not the commit landed, which reads as
     failure either way and proves nothing.
   - it changed a file mode, a binary, or a rename → text search cannot see it.
3. Strongest, and the only option when the change is a mode/binary/rename or has
   no marker unique to it: compare the OBJECT. `git ls-tree <mergeCommit> -- <path>`
   against `git ls-tree <headRefOid> -- <path>` matches mode, type and blob id, so
   identical output IS byte-identical content. Prefer this to `--stat`, which
   reports only that a path was touched: when an earlier commit in the same PR
   also touched that path, it prints a line that looks like success while the
   final update is exactly what went missing.
4. If the final commit is a pure revert of an earlier one in the same PR, check the
   NET effect, not the last hunk.

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
resolve (`Cannot find module ...`) is an environment state, not a code defect.
Which state it is decides the remedy, and the two look alike:

- **Missing build output** — the import names a workspace package (`nextly/...`,
  `@nextlyhq/...`) and dozens of files fail at once. Its `dist` was never built.
  Run integration tests from the ROOT so turbo builds first; `pnpm install` does
  not produce `dist` and will leave this exactly as it was.
- **Stale install** — the import names an external dependency, or one package
  resolves while its sibling does not, after `pnpm-lock.yaml` moved underneath
  you. `pnpm install --frozen-lockfile` in that worktree.

Check whether the package's `dist` exists before choosing.

Related, and cheap to get wrong:

- **Run gates from the worktree ROOT.** From a package directory,
  `pnpm check-types --force` becomes a bare `tsc --force` and fails on the flag.
- **Most packages fail lint on a WARNING**, because their script is
  `eslint . --max-warnings 0`. Check by exit code, not by grepping output for
  "error": the log reads "0 errors, 1 warning" and still exits 1.
  Two qualifications worth knowing before you trust a green:
  - The pre-push hook runs `pnpm turbo lint --continue --filter='./packages/*'`,
    not the root `pnpm lint`. It does not cover `apps/*` or `e2e/`.
  - Not every package opts in. `packages/admin-css` runs a bare `eslint .`, so a
    warning there exits 0 and the hook stays green.
- **Never run a unit suite while an integration leg is in flight.** Unrelated
  files time out and read like a broad regression.
- **Never work a PR branch in the shared checkout.** Use `git worktree add`;
  another session switching branches underneath you removes files mid-command.
