---
paths:
  - "**/*"
---

## A squash merge makes every ancestry check unsound

Merging squashes the branch into one new commit, so the branch head is **never**
an ancestor of `main`. `git branch --merged`, `git log | grep <sha>` and "is
this commit in main" therefore answer confidently and wrongly. Verify by
CONTENT.

**Which marker you grep for is load-bearing.** The commonest shape is a lost
TAIL: commits land on the branch after GitHub computed the merge, or the merge
runs from a stale head, so the END of the branch goes missing and a marker taken
from an early commit passes cleanly on a PR that dropped its last three.

That heuristic says where to look FIRST; it is not what makes a check
sufficient. A branch that was rebased, amended or force-pushed after the merge
was computed diverges differently — rewriting an EARLIER commit while leaving
the final patch text unchanged means the stale merge still contains your
final-commit marker, and the check passes over content that was rewritten
underneath it. When history was rewritten, compare the delta (step 3) rather
than trusting any single marker.

1. Confirm what was actually merged, then FETCH the object before probing it:

   ```
   gh pr view N --json headRefOid,mergeCommit
   git fetch origin <mergeCommit> <headRefOid>   # gh reports; it does not fetch
   ```

   `gh pr view` prints PR information and adds nothing to the local object
   database, so probing a reported SHA without this exits with
   `unable to resolve revision` — which reads as a failed verification rather
   than as a missing object.

   Fetch BOTH. A squash commit does not have the PR head as an ancestor, so
   fetching only the merge commit leaves `headRefOid` unresolvable — and step 3
   dereferences it. Outside the PR worktree, or after the branch is deleted,
   that is where the procedure stops.

   Probe that **merge commit**, never `origin/main`. Run before a fetch and
   `origin/main` is still the pre-merge ref, so every check reports loss
   falsely; run after `main` advances and a later commit can make omitted
   content look present.

2. Take the check from the **final** commit, in whichever direction it changed
   things. A marker only proves anything if it is UNIQUE to that commit and the
   search is SCOPED to the path it changed — a string that also occurs elsewhere
   answers the same way whether or not the commit landed. Match it as a FIXED
   string: a marker containing `.`, `[` or `*` is otherwise a pattern, and can
   match text it was never taken from.
   - it ADDED content → `git grep -F -e "$marker" <mergeCommit> -- <path>`;
     expect a hit. The `-e` is not optional: a marker beginning with `-`, which
     a Markdown list item usually does, is otherwise parsed as an option and
     exits 129 without checking anything.
   - it only REMOVED content → same command; expect NO hit. Grepping for ADDED
     text here finds nothing whether or not the commit landed, which reads as
     failure either way and proves nothing.
   - it changed a file mode, a binary, or a rename → text search cannot see it.
3. When nothing is unique to the commit, or the change is a mode/binary/rename,
   compare the PR's **delta** — not the whole object. Diffing the merged path
   entry against the branch-head entry (`git ls-tree`, blob ids) is wrong as soon
   as `main` changed ANOTHER hunk of the same file after the branch point: a
   correct squash contains both changes, the blobs legitimately differ, and the
   check reports a loss that did not happen. Compare what the PR itself changed:
   `git diff <mergeBase>..<headRefOid> -- <path>` against
   `git diff <mergeBase>..<mergeCommit> -- <path>`, expecting the PR's hunks in
   the second. Whole-object equality is sound only when `main` never touched the
   path. `--stat` is never sound: it reports only that a path was touched, which
   any earlier commit in the same PR already guarantees.
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
resolve (`Cannot find module ...`) is USUALLY an environment state. Three
candidates, and the remedies differ:

- **Missing build output** — the import names a workspace package (`nextly/...`,
  `@nextlyhq/...`) and dozens of files fail at once. Its `dist` was never built.
  Run integration tests from the ROOT so turbo builds first; `pnpm install` does
  not produce `dist` and will leave this exactly as it was.
- **Stale build output** — `dist` EXISTS but predates a source or export-map
  change the rebase brought in, so it lacks the subpath now being imported. An
  existence check on the directory says "built" and is wrong. Rebuild from the
  root rather than trusting that `dist` is there.
- **Stale install** — the import names an external dependency, or one package
  resolves while its sibling does not, after `pnpm-lock.yaml` moved underneath
  you. `pnpm install --frozen-lockfile` in that worktree.

**Do not label it environmental without looking at what `main` changed.** If the
moved `main` altered a workspace export map, a package manifest, a tsconfig path
mapping or a shared build config, an untouched package failing to resolve is a
real regression wearing the same costume.

The comparison needs the **pre-rebase** base, and this is the trap: after the
rebase, `git merge-base HEAD origin/main` IS `origin/main` — it is now an
ancestor — so the diff is empty no matter what the rebase brought in. An empty
diff then reads as "main changed nothing relevant", which is the opposite of
what it means. Capture the old base before rebasing, or recover it afterwards:

```
OLD=$(git rev-parse ORIG_HEAD)           # rebase records the pre-rebase tip here
git diff $(git merge-base $OLD origin/main)..origin/main
```

`ORIG_HEAD` (equivalently the BRANCH reflog, `<branch>@{1}`) is the pre-rebase
tip. **`HEAD@{1}` is not** — after a multi-step rebase that is the last
`rebase (pick)` entry, so the merge base comes out as the new `origin/main`
again and the diff is empty exactly as before, with the fix appearing to be in
place.

**Read that delta UNFILTERED.** A path list here is the same enumeration trap:
the first version named `package.json`, `tsconfig*.json` and `turbo.jsonc`, and
would have printed nothing for a change to `packages/*/tsup.config.ts` (which
decides what `dist` contains) or to `pnpm-lock.yaml` (which decides what
resolves) — the two inputs most likely to explain the failure being diagnosed.
Scan the whole delta, then narrow.

Then decide: a rebuild that "fixes" it silently absorbs a breaking change into
your branch, and a rebuild that does not fix it has told you something.

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
