<!--
No `paths` frontmatter: Claude Code loads such a rule at launch,
unconditionally, while a rule WITH the field — including `paths: ["**/*"]` — is
conditional and triggers only when a matching file is read. Verifying a merge is
an act rather than a file type, and the checks below are needed before any file
of the merged work has been opened.
-->

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

### None of the steps below can detect a lost tail

They all read `headRefOid`, and **`headRefOid` is the MERGED head** — the
snapshot GitHub took when it computed the merge, not the branch's current tip.
A commit pushed after that snapshot is outside the procedure entirely: absent
from the merge, absent from `headRefOid`, and therefore absent from both sides
of every comparison here. Each step then confirms that everything which merged,
merged.

The independent source is the ref itself. The guard is part of the check, not a
note beside it, because the failure it prevents looks exactly like a pass:

Two remotes are in play and they are not interchangeable. `BASE_REMOTE` holds
`main` and the merge commit; `HEAD_REMOTE` holds the PR's branch, and for a fork
that is a different repository entirely:

```sh
PR=<number>
read -r CROSS OWNER REPO BR GH MERGE < <(gh pr view "$PR" \
  --json isCrossRepository,headRepositoryOwner,headRepository,headRefName,headRefOid,mergeCommit \
  --jq '[.isCrossRepository,.headRepositoryOwner.login,.headRepository.name,
         .headRefName,.headRefOid,.mergeCommit.oid]|@tsv')
BASE_REMOTE=origin                        # must point at the BASE repository
HEAD_REMOTE=origin
[ "$CROSS" = true ] && HEAD_REMOTE="https://github.com/$OWNER/$REPO.git"

# History rewritten? Then the range below cannot certify anything, so this
# EXITS rather than annotating. `--paginate` because the timeline is paged at
# 100 and long PRs here run to three pages: an unpaginated query reads page one
# and answers zero, which is the reassuring direction. It emits one count per
# page, hence the sum.
FORCED=$(gh api --paginate "repos/nextlyhq/nextly/issues/$PR/timeline?per_page=100" \
  --jq '[.[]|select(.event=="head_ref_force_pushed")]|length' | awk '{s+=$1} END{print s+0}')
if [ "${FORCED:-1}" -gt 0 ]; then
  echo "PR#$PR: $FORCED force-push(es) — NOT CHECKABLE, which is not clean" >&2
  exit 2
fi

TIP=$(git ls-remote "$HEAD_REMOTE" "refs/heads/$BR" | cut -f1)
if [ -z "$TIP" ]; then
  echo "PR#$PR: no such ref on $HEAD_REMOTE — NOT CHECKABLE, which is not clean" >&2
  exit 2
fi
git fetch "$HEAD_REMOTE" "$TIP" --quiet
git fetch "$BASE_REMOTE" "$MERGE" --quiet
git log --oneline "$GH..$TIP"          # candidates: commits absent from the merge
```

Fetch each object from the remote that HAS it. The head commit of a fork PR is
not on `origin`, so fetching it from there fails and the procedure stops before
the content checks — reading as a broken verification rather than as a lookup
pointed at the wrong repository.

**An empty `TIP` degenerates the range and the check reports clean without
having looked.** Three things produce it, and only the first is unanswerable:

- the branch was deleted after merging — NOT CHECKABLE;
- **the PR came from a FORK**, so its branch was never on `origin` at all. This
  one is the trap, because the empty result is indistinguishable from deletion
  and invites exactly the wrong conclusion. `isCrossRepository` is what settles
  it, so query the head repository rather than the base;
- **`$BR` names no ref**, because it was typed from memory or from a task file
  rather than read from `headRefName`. Measured here: a lane checked a PR that
  HAD stranded a commit, used a branch name one word off from the real head ref,
  got an empty tip, and concluded the branch had been auto-deleted. The branch
  existed the whole time, and the correct query reports the stranded commit.

Derive every field in the same command that uses it, and treat an empty tip as a
refusal to answer.

**A force-push can erase the evidence, and the range then reports clean.** If
merged head `A` was followed by stranded commit `B`, and the branch was later
reset back to `A`, the range is `A..A` — empty, and indistinguishable from a
branch that never had `B`. Nothing local can recover `B`, because the ref that
pointed at it is gone.

So `FORCED` is not decoration. A non-zero count means the tip you are comparing
against is not the history that was pushed, and this check CANNOT certify the
PR — say NOT CHECKABLE and fall back to content, per-commit, from whatever
record of the intended commits exists. The timeline reports the event
(`head_ref_force_pushed`, with the actor and the resulting `commit_id`) but not
the history it replaced, so detection is all it offers.

Do not reach for the timeline's `committed` entries to recover them: measured on
a PR with two force-pushes, they number exactly what `pulls/N/commits` returns —
both describe the current head's history, neither the erased one.

**Output is a CANDIDATE LIST, not a verdict.** The range says only "absent from
the merged head", and a surviving branch collects commits for other reasons: it
was force-pushed or rebased, it was reused for follow-up work, or someone kept
pushing after the merge. Each is legitimately absent from the squash and none is
a lost tail. Screen with this, then confirm each named commit by CONTENT against
the merge commit — a marker unique to it, scoped to the path it changed — before
calling anything lost. Cheap in both directions: the screen costs one command
and the confirmation is what you can put in a claim.

The symmetry is the point. Reading the range as a verdict OVER-reports; every
instrument in the table below UNDER-reports. Only the pairing answers.

Measured against a PR known to have lost two commits and one known intact:

| instrument                              | lost 2 commits | intact    |
| --------------------------------------- | -------------- | --------- |
| `headRefOid`'s date predates the merge  | "clean"        | "clean"   |
| step 3's delta comparison               | IDENTICAL      | IDENTICAL |
| `gh api pulls/N/commits`                | 2 commits only | complete  |
| `git log <headRefOid>..<ls-remote tip>` | 2 STRANDED     | empty     |

The first three are not weak checks; they cannot see this class of defect at
all, because each derives from the snapshot being audited. That is worth stating
because the delta comparison is the most rigorous-looking option on offer, and
its thoroughness is what earns the trust it does not deserve here. The commits
API is the most tempting of the three — it is named as though it lists what the
branch contained, and it lists what merged.

Three PRs lost tails on a single day in this repository, one of them carrying a
P1 and one leaving `main` red, and none was found by the procedure below.

### Three different questions, and content answers only one

They are easy to run together and none substitutes for another:

- **Did my code land?** — content, from the final commit. What the numbered
  steps below answer.
- **Did EVERY commit land?** — the `ls-remote` comparison above. Content from a
  commit that merged cannot reach a commit that did not.
- **Was the job green?** — the merge commit's own check-runs, asserted as
  `success`. A PR merged here with two `Integration` jobs failing and left
  `main` red for hours; its author had verified the content correctly and that
  check had nothing to say about the failure.

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

     **An absent marker is only evidence once you have shown the search CAN
     find it.** `git grep` exits 1 for "no lines selected" and for "the
     pathspec matched no files" alike, so a mistyped or since-renamed `<path>`
     certifies the removal without ever reading the file. Run the same command
     against `<headRefOid>^` and require a hit: that proves the path resolves
     and the marker is real.

     **But that control validates the INSTRUMENT, not the outcome, and for a
     removal it cannot validate the outcome at all.** If the text was added
     earlier in the same PR and removed later, `<mergeCommit>^` — the state
     `main` was in before the merge — never contained it, so its absence
     afterwards is guaranteed whether or not the removal landed. Neither
     preimage separates "the removal merged" from "the text was never there".
     Absence is simply not a witness here.

     So for a removal, use the control to prove the search works, then prove
     the outcome with the DELTA in step 3: the removal hunk must appear in
     `git diff <mergeCommit>^..<mergeCommit> -- <path>`. That is a positive
     observation of the change landing rather than an inference from nothing
     being found.

   - it changed a file mode, a binary, or a rename → text search cannot see it.

3. When nothing is unique to the commit, or the change is a mode/binary/rename,
   compare the PR's **delta** — not the whole object. Diffing the merged path
   entry against the branch-head entry (`git ls-tree`, blob ids) is wrong as soon
   as `main` changed ANOTHER hunk of the same file after the branch point: a
   correct squash contains both changes, the blobs legitimately differ, and the
   check reports a loss that did not happen. Compare what the PR itself changed:
   `git diff <mergeBase>..<headRefOid> -- <path>` against
   `git diff <mergeCommit>^..<mergeCommit> -- <path>`, expecting the PR's hunks
   in the second. The squash side is diffed from its OWN parent: a squash
   commit's parent IS `main` at the moment of the merge, so that range is
   exactly the squash patch. Using `<mergeBase>` there sweeps in every commit
   `main` gained after the branch point, and the PR's hunks disappear among
   them. Whole-object equality is sound only when `main` never touched the
   path. `--stat` is never sound: it reports only that a path was touched, which
   any earlier commit in the same PR already guarantees.

   **This step answers "was the squash rewritten", never "did every commit
   land".** The two sides are different objects — the PR side is bounded by
   `<headRefOid>`, the squash side is `main`'s own history at
   `<mergeCommit>^..<mergeCommit>` — but neither can contain a commit that never
   merged, so a commit pushed after the merge was computed is outside both and
   the comparison returns IDENTICAL. Run the `ls-remote` check above first; this
   one is not a substitute for it.

4. If the final commit is a pure revert of an earlier one in the same PR, check the
   NET effect, not the last hunk.

The danger window is push-a-fix-then-merge-immediately, which is what everyone
does once CI is green and threads are cleared. A PR has already merged here
missing its last commit, reading as complete with every thread resolved.

**Detection is cleanup; the gate is the fix.** Everything else in this file runs
after something has already shipped. Merge with the head you verified as a
PRECONDITION, so the merge itself refuses when the branch has moved:

```sh
gh pr merge "$PR" --squash --match-head-commit "$GH"
```

`$GH` is `headRefOid` from the block above — the revision the green checks and
the clean review belong to. Bind it to that variable rather than retyping a SHA:
a merge precondition naming the wrong revision either refuses a correct merge or,
worse, permits the one it was added to stop.

Re-reading `ls-remote` immediately before merging is better than not, and it is
still two operations: a push arriving between the read and the merge is exactly
the window being closed, and narrowing a race is not closing one. `--match-head-commit`
makes the check and the merge a single atomic operation on GitHub's side, which
is the difference between a boundary and a look — and this file exists because a
look was taken and the branch moved anyway.

**No `--admin` here, deliberately.** It merges a PR that does not meet the
repository's requirements — the pending or failing checks and the missing
reviews — which is precisely what the verified `$GH` exists to protect. Pairing
them writes a command that pins the exact revision and then waives the reasons
for pinning it. Where a project genuinely needs the override, add it as its own
decision and keep `--match-head-commit`: the two flags answer different
questions, and only one of them is a bypass.

## A red head is grounds to look, not a finding

The other half of the same window: the merge snapshots a head, and CI on that
head is independent of the snapshot. So a PR can merge from a head whose jobs
had already concluded `failure` — one did here, leaving `main` red.

It does not follow in general. The merge commit is a different tree from the
head, and it is the one that decides. So establish the state of `main` by
CONTENT — does it carry the failing assertion, and does it carry the fix —
rather than by reading a job colour belonging to a tree that was never merged.

**Reading the merge commit's checks instead has its own trap, and it is the one
that bites.** Querying for `conclusion == "failure"` and finding none reads as
green and is not: measured on one merge commit here, `Integration (postgres)`,
`Integration (mysql)`, `Integration (sqlite)` and `Lint / Typecheck / Test /
Build` were all still `queued` hours later, with two unrelated jobs `completed`.
Zero failures, because nothing had finished. Assert `success` on each job you
name; never infer it from the absence of a failure.

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
OLD=$(git rev-parse "$(git branch --show-current)@{1}")   # pre-rebase tip
git diff $(git merge-base $OLD origin/main)..origin/main
```

The BRANCH reflog is the reliable source: a rebase moves the branch ref once, so
`<branch>@{1}` is its pre-rebase tip and nothing but another update to that
branch disturbs it.

Two tempting alternatives are both wrong. **`ORIG_HEAD` is volatile** — it is
rewritten by any later command that sets it, `git reset` included, so a single
`git reset --hard HEAD` after the rebase leaves it pointing at the REBASED tip
and the diff comes out empty again. **`HEAD@{1}` is not the pre-rebase tip
either** — after a multi-step rebase it is the last `rebase (pick)` entry, so the
merge base comes out as the new `origin/main`
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
