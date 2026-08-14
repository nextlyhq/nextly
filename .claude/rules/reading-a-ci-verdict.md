<!--
No `paths` frontmatter, for the reason `verifying-merged-work.md` gives: a rule
without the field loads at launch, a rule with one — `paths: ["**/*"]`
included — triggers only once a matching file is read. Reading a CI verdict is
an act rather than a file type, and every check below is needed before any file
of the work has been opened.
-->

## Green means nothing reported a failure

That is a weaker statement than "the checks passed", and the gap between them is
where this file lives. `verifying-merged-work.md` answers **did my code land**;
this one answers **was anything actually run**. Both have been verified
correctly on the same PR while it was broken, because they are different
questions and each reads complete on its own.

Every section below is a way the second question comes back green with no job
having reported anything. They are not variations on one mistake: a dropped
trigger, a base that filters the workflow out, a dependency that skipped its
dependents, and a run bound to a commit that no longer describes reality each
produce an identical rollup, and none produces a red anywhere to notice.

**The one habit that covers all of them: decide which jobs this commit REQUIRES,
then assert `success` on each of those.** Absence of `failure` is not a
verdict — `queued`, `in_progress`, `skipped` and _never triggered_ all satisfy
it.

```bash
set -o pipefail
gh api "repos/nextlyhq/nextly/commits/$PR_HEAD_SHA/check-runs?per_page=100" \
  --paginate --jq '.check_runs[]|"\(.status)/\(.conclusion // "none")\t\(.name)"' \
  | sort || { echo "check-runs query FAILED — not clean" >&2; exit 2; }
```

That command REPORTS; it does not gate. `sort` exits 0 for any successful
response, including one whose rows are all `queued`, and including an empty
`check_runs` array — so piping it into a merge decision reproduces the false
clean this file is about. Read it, then assert `success` on each job the scope
decision requires, and exit nonzero otherwise.

**Query the PR HEAD sha, not the merge sha.** They are different commits and
only one carries the checks: measured on this PR, `commits/<head>/check-runs`
returned 31 rows and `commits/<merge_commit_sha>/check-runs` returned 0. For an
open PR that `merge_commit_sha` is GitHub's own test-merge, which nothing runs
against. (Inside a workflow the relationship inverts, but only for `pull_request`:
there `github.sha` IS the synthetic merge commit. On `pull_request_target` it is
the tip of the BASE branch — `main` for an ordinary PR, and the PARENT FEATURE
BRANCH for a stacked one, so `labeler.yml` and `pr-title.yml` see whichever the
PR targets rather than the PR's own revision. On `push` it is the pushed commit.
Do not carry a variable named `SHA` between contexts, and qualify the claim by
event AND by base before relying on it.)


**`set -o pipefail` is load-bearing, not tidiness.** Without it the exit status
is `sort`'s, so an authentication failure, a rate limit or a transient 5xx from
`gh` yields an empty list AND a success status — the precise false-clean this
file exists to prevent, reproduced by the command recommending against it. An
unavailable answer must never read as a passing one.

**Requiring `success` from a FIXED list is the obvious form and it is wrong
here**, because some skips are the pipeline working. `ci.yml`'s first job
decides what the commit can affect and publishes an `inert` output, and
`Lint / Typecheck / Test / Build` carries `if: needs.changes.outputs.inert != 'true'`.
A docs-only commit therefore skips it BY DESIGN, and its three dependents with
it — so a fixed list makes a correct docs-only PR permanently unverifiable, and
whoever hits that learns to wave the rule through.

The expected set is DERIVED, not enumerated. `Decide what this commit can
affect` is the job that knows, so it is the one to require unconditionally:

- `Decide what this commit can affect` — must be `success`. It fails open
  (every early exit sets `inert=false`), so a broken decision costs a full run
  rather than a silent pass.
- `inert=true` → `Lint / Typecheck / Test / Build` and its dependents are
  legitimately `skipped`.
- `inert=false` → each of them must be `success`.

**Both kinds of skip render identically**, which is the whole difficulty: a job
skipped because the scope decision excluded it and a job skipped because its
dependency failed are both `completed/skipped`. What separates them is not the
row — it is whether the job they depend on succeeded. Read the decision, then
read the jobs it implies.

Measured on `59d84ddc0`, 39 check-runs: **33 `completed/skipped`**, 3 `success`,
3 `failure`. Even with every job now finished, a rollup dominated five-to-one by
jobs that declined to run is not the coverage the count suggests — and when that
commit was first read, four of those rows were `queued/none` and none had
failed, so a query for `conclusion == "failure"` returned nothing and read as
green.

**Re-measure rather than quote a figure from a handoff.** The reading above is
not the one recorded when the incident was filed: `queued` rows complete, and
the snapshot that proves "nothing had run" stops reproducing within hours. The
shape is durable, the numbers are not, and a stale count cited as current is the
same error this file is about.

**So record the EVENT, not the state.** The distinction matters more than
timestamping, because a perishable claim does not merely expire — it discredits
the durable claim welded to it. "It merged with all eight checks queued,
nothing having run" is two statements: _it merged while its checks were queued_
is an event and stays true forever, while _nothing ran_ rots within minutes.
Anyone re-checking later sees an ordinary green result, concludes the whole note
was misread, and discards the true half with the false one.

Two `queued` rows are a photograph of something that is by definition about to
stop being true. Write down what HAPPENED and the query that would have shown
it; leave the counts as illustration, marked as of a moment. Where a durable
witness exists, prefer it outright — `skipped` persists, which is why the
dependent-job cascade below makes a better standing example than any count of
pending jobs.

## Ask whether the RUN exists, not how many checks there are

A workflow that never fired and a workflow waiting for a runner look the same
from the checks list, and the obvious discriminator is wrong.

**Counting checks does not separate them.** A queued workflow contributes fewer
checks than a running one, because its jobs become checks only once it starts.
Observed on #758: 9 checks and no `Lint / Typecheck / Test / Build`, which reads
exactly like a dropped trigger — while `gh run list` showed the `CI` workflow
present and `queued`. Nothing had been dropped; the runners were busy. PR #753
sat for a day at 5 green checks, and that one was real.

Both counts have since risen to 17 and 14 as their runs finished, which is the
point: a check COUNT is a reading of one moment and cannot be re-derived later.
Nor is there a total to compare against — the matrices expand with the diff, so
a change touching `templates/base/**`, `templates/blank/**` or `templates/blog/**`
adds `scaffold-build.yml`'s matrix legs on top of everything else. Note which
paths those are: `templates/plugin/**` is deliberately NOT in that trigger list,
so a plugin-template PR correctly gets no scaffold run, and expecting one there
turns a working filter into a suspected dropped trigger. **Do not substitute one fixed number for another**; a document
whose conclusion is that counts are unreliable should not hand you a range to
check counts against. The run-level query is the discriminator.

Ask at the workflow level, **scoped to the commit and to the workflow you
require**:

```sh
gh run list --commit "$HEAD_SHA" --workflow ci.yml --limit 5 \
  --json name,status,conclusion,event \
  --jq '.[]|"\(.status)/\(.conclusion // "-")  \(.event)  \(.name)"'
```

**`--branch` alone is not enough, and it fails in the reassuring direction.** It
returns the branch's runs from EARLIER commits as well, so a workflow that was
dropped for the current head still shows a run — the previous push's — and reads
as present.

**`--commit` narrows that and does not close it**, because a SHA is not an
event. Close-and-reopen — recommended below for a retargeted PR — produces a
second run at the SAME head, so if the `reopened` event is the one that got
dropped, the earlier run still answers and the workflow reads as present. Where
that matters, compare the run's `createdAt` against the event you are gating on,
or capture the run ID before the event and require a different one after. It also sweeps in unrelated `pull_request` workflows, so the list
looks populated whatever happened to the one you care about. Pin `--commit` to
the head you are gating, and ask per required workflow rather than eyeballing a
mixed list.

A busy queue returns a run, `queued`. **An empty result is not yet a finding**,
because three different things produce it and only one is a defect:

- **a dropped trigger** — the event should have started this workflow and did
  not. A push re-triggers it.
- **a path filter excluded the commit** — `paths` or `paths-ignore` in the
  workflow's own `on:` block. Legitimate, and nothing is wrong.
- **a base filter excluded the PR** — `branches: [main]` against a stacked base,
  which is the section below.
- **the PR has a merge conflict** — GitHub cannot compute `refs/pull/N/merge`,
  so no `pull_request` workflow runs at all. The remedy is to resolve the
  conflict; a push that does not resolve it changes nothing, which reads as the
  trigger still being dropped.

Settle it by reading that workflow's `on:` block against this commit's diff, not
by looking harder at the run list. All four return the same nothing.

**Reading the diff LOCALLY is not the same comparison GitHub made**, and on a
large change it disagrees. Path filters are evaluated against the first 300
files of the generated diff, so a matching path beyond that boundary does not
trigger the workflow — while a local `git diff` sees it and says the run should
exist. That reads as a dropped trigger and invites a push that changes nothing.
Above 300 files, treat the discriminator as INDETERMINATE and say so, rather
than reporting a defect the evidence cannot support.

**Measured on this very PR**, which is the cheapest available demonstration:
`integration.yml` declares `paths-ignore: ["docs/**", "**/*.md"]`, the diff is
one `.md` file, and the workflow correctly produces no run at all. Reading that
absence as a dropped trigger would mean pushing to "fix" a filter doing its job —
and, because `ci.yml` was `queued` at that moment, the push would have cancelled
the one run that mattered.

**The remedies are opposite, which is why guessing is expensive.** Any push
re-triggers a genuinely dropped run. The fix for a path-filtered absence is to
do nothing at all. And pushing at a QUEUED run may cancel it — but only where
the workflow says so, and that is per workflow rather than a property of
pushing:

| workflow          | concurrency                        | a push at a queued run                  |
| ----------------- | ---------------------------------- | --------------------------------------- |
| `ci.yml`          | group + `cancel-in-progress: true` | cancels and re-queues at the back       |
| `integration.yml` | group + `cancel-in-progress: true` | cancels and re-queues at the back       |
| `preview.yml`     | group + `cancel-in-progress: true` | cancels and re-queues at the back       |
| `secret-scan.yml` | **none declared**                  | starts a SECOND run; the first survives |

So read the workflow's `concurrency:` block before deciding a push is expensive.
Three of the four here cancel; the fourth does not, and treating its queued run
as fragile costs a wait for no reason.

## A stacked base runs none of the jobs that gate a merge

Four workflows are declared `pull_request: branches: [main]`, so a PR whose base
is another FEATURE BRANCH never triggers them. Measured across
`.github/workflows/`:

| workflow                                  | trigger                                    | fires on a stacked PR? |
| ----------------------------------------- | ------------------------------------------ | ---------------------- |
| `ci.yml`                                  | `pull_request: branches: [main]`           | **no**                 |
| `integration.yml`                         | `pull_request: branches: [main]`           | **no**                 |
| `secret-scan.yml`                         | `pull_request: branches: [main]`           | **no**                 |
| `preview.yml`                             | `pull_request: branches: [main]`           | **no**                 |
| `labeler.yml`, `pr-title.yml`             | `pull_request_target`                      | yes                    |
| `scaffold-build.yml`, `package-smoke.yml` | `pull_request` + `paths`, no branch filter | yes, if a path matches |

**This is the most dangerous entry in the file, and the last two rows are why.**
A stacked PR is not visibly empty of CI. It carries the two
`pull_request_target` checks and, whenever it happens to touch one of the
scaffold-eligible template directories, `packages/ui/**` or the lockfile,
path-filtered builds as well — and those carry
matrices, so `scaffold-build.yml` alone contributes six legs. A stacked PR can
therefore present a comfortably populated list of green checks, several of them
having genuinely compiled something. **No bound is given here deliberately**:
the count comes from whichever matrices the diff triggered, and quoting a
ceiling would reintroduce exactly the fixed number this file argues against.
There is no red to notice and nothing conspicuously missing.

**A stacked PR's CI verdict is therefore UNOBTAINABLE, not pending.** Local runs
are the only evidence until the base is `main`.

**Retargeting alone does not start CI**, which is the trap on the way out.
Changing a PR's base emits the `pull_request` activity `edited`, and the default
activity set is `opened`, `synchronize` and `reopened` — none of these four
workflows declares `types:`, so none subscribes to `edited`. Retargeting makes
the branch filter eligible and emits an event nothing is listening for, leaving
a PR that now LOOKS main-targeting with still no substantive run against it.

Follow it with an operation that DEMONSTRABLY moves the head, then confirm a
new run exists. A plain `git rebase main` is not that: when the branch is
already a descendant of `main` it reports the branch up to date and changes
nothing, so the push that follows emits no `synchronize` and the four
main-filtered workflows stay absent — having done exactly what the instruction
said. `git rebase --force-rebase` (or `--no-ff`) replays regardless, and an
empty commit or a close-and-reopen also start CI.

The check that follows depends on which you picked, and conflating them rejects
a remedy that worked:

- **rebase, push, empty commit** — the head SHA must DIFFER afterwards, and
  `gh run list --commit <new head> --workflow ci.yml` must return a run.
- **close and reopen** — the head cannot differ, by construction. Require a run
  whose identity is NEW instead: capture the run ID before reopening and require
  a different one after, or compare `createdAt` against the reopen.

Either way something must be confirmed to have started. A remedy that is
believed to have worked is how a stacked PR sits for a day looking retargeted.
 Close-and-reopen
also starts CI and is the worse remedy, because it leaves the head SHA
unchanged: the diff expands to include the parent stack while every existing
review still points at that same SHA, so a coverage check keyed on the head
happily reuses reviews taken when those commits were not in scope. A rebase
moves the head and invalidates them, which is the outcome you want. Then gate on
the run, never on the base having been changed.

**Retargeting changes what a review MEANS, not just what CI runs.** A review is
evidence about a diff, and the diff is `base..head`; moving the base moves the
diff underneath a head that has not moved. Where a stacked PR is retargeted
without a rebase, treat every review predating the retarget as stale regardless
of the SHA it names.

## A failed job takes its dependents with it, silently

`ci.yml` fans out from one job:

```text
changes -> ci (Lint / Typecheck / Test / Build) -> e2e            (Browser tests)
                                                -> scaffold-smoke (Scaffold smoke)
                                                -> dev-script-smoke (Dev script ...)
```

All three declare `needs: [ci]`. When `ci` fails they do not run, and a skipped
dependent looks nothing like a failure — so three jobs of coverage leave every
PR at once, reported as one red job.

Measured on PR #787's head `d243c855c`, which is what that looks like:

```text
completed/failure   Lint / Typecheck / Test / Build
completed/skipped   Browser tests
completed/skipped   Dev script starts every watcher (${{ matrix.os }})
completed/skipped   Scaffold smoke (${{ matrix.os }})
completed/success   Integration (mysql|postgres|sqlite), gitleaks, ...
```

Nine green rows, one red, and three jobs that were never evaluated.

The consequence is the trap: **fixing `ci` is the first time those three are
evaluated at all.** Treating a run as "one failure, now fixed" understates it by
three untested jobs, and their first real execution is the push you were
expecting to be green.

## A completed run does not re-evaluate when `main` moves

A run is bound to the commit and merge ref evaluated when it started. When a
broken `main` is fixed, every PR that went red because of it **stays red**. No
one's checks clear themselves, and a stale red is indistinguishable from a real
one on inspection.

**A re-run re-fetches the ORIGINAL merge commit, so it does not pick the repair
up.** Two phases decide this and reading only the second one inverts the answer.

GitHub's documentation says a re-run "will also use the same `GITHUB_SHA`
(commit SHA) and `GITHUB_REF` (git ref) of the original event that triggered the
workflow run". `actions/checkout` then FETCHES using that pinned commit —
`getRefSpec` in the pinned action, with `commit` non-empty:

```ts
else if (upperRef.startsWith('REFS/PULL/')) {
  const branch = ref.substring('refs/pull/'.length)
  result.push(`+${commit}:refs/remotes/pull/${branch}`)
}
```

Only afterwards does `getCheckoutInfo` name `refs/remotes/pull/N/merge` — a
LOCAL ref the fetch above just populated from the pinned commit. Reading that
second phase alone suggests the ref is resolved fresh from the server. It is
not: the name is reused, the content is pinned.

So a re-run of `ci.yml`, `integration.yml` or `preview.yml` evaluates the same
synthetic merge of your branch with the OLD, broken `main`, and goes red again
for the original reason — which reads as the failure being real and yours.

**A full-history job is a partial exception, and only in what it can SEE.**
`getRefSpecForAllHistory`, used at `fetch-depth: 0`, additionally fetches
`+refs/heads/*:refs/remotes/origin/*`, so `origin/main` there is current. The
checked-out tree is still the original merge, so this changes what a script
querying `origin/main` observes, not what gets built or tested.

**One measurement here does not fit this and is recorded rather than
explained.** Run `31755967442` on #777: attempt 1 failed at
`Bare-Error guard controls (unit)` — believed to be the allowlist ratchet broken
on `main` at the time — and after the repair merged, attempt 3 of the same run
passed that step. The code path above says the checkout could not have carried
the repair, and the step consults no git command, so the likeliest reading is
that attempt 1 failed for a different reason than the one attributed to it.
Noted because a single uncontrolled observation should not be quietly dropped
for disagreeing with the source, and because whoever resolves it should know
both existed.

**Rebase or push is correct under either reading**, and needs no determination
first: it creates a new event, a new merge commit, and a run nobody has to
reason about. Prefer it when a moved base is the suspicion.

`gh run rerun` is the right tool for a genuine flake, where the base is not in
question:

```sh
gh run rerun "$RUN_ID"            # whole run
gh run rerun "$RUN_ID" --failed   # only the failed jobs
```

`--failed` re-runs failed jobs and their dependencies, so on a run with no
failed job it re-runs nothing and reports success having done nothing. **Decide
that from the JOB conclusions, not the run's.** A cancelled run can still
contain a failed job — one matrix leg fails, someone cancels while another is
still executing — so the run-level `cancelled` neither implies nor excludes work
for `--failed` to do:

```sh
gh run view "$RUN_ID" --json jobs \
  --jq '.jobs[]|select(.conclusion=="failure")|.name'
```

This cuts the other way too, and that is the more common error: a red inherited
from `main` is not evidence about the branch. Before working a failure, confirm
it reproduces from the branch's own diff — see `verifying-merged-work.md` on
naming the mechanism before calling something flake.

## A reviewer that never reviewed reads as a reviewer with no findings

The same shape outside CI. Both bots here can report nothing for reasons that
have nothing to do with the code.

**Match the bot's COMPLETE login, which carries a `[bot]` suffix.** Measured on
this repo's PRs:

```text
chatgpt-codex-connector[bot]
coderabbitai[bot]
pkg-pr-new[bot]
```

Filtering for `chatgpt-codex-connector` returns zero, byte-identically to "not
yet reviewed". That cost four watch cycles on #785 reporting no verdict while a
clean one had been sitting there since 03:00.

**The suffix was the defect, not the equality — so do not fix it by loosening
the match.** A substring filter such as `test("codex";"i")` accepts any login
CONTAINING the word, so any account that can comment on the PR can present
itself as the trusted reviewer and supply a clean-looking verdict. Trading a
false negative for a spoofable one is a worse trade than it looks, because the
false negative announces itself as "no verdict" and the spoof announces itself
as approval.

The properties a verdict gate has to hold are below. **They are implemented in
`scripts/ci-verdict.mjs` with a `.test.mjs` neighbour**, run by
`pnpm test:scripts` in CI, rather than written out here as shell.

**Moving the decisions into testable code does not move the RISK there with
them, and that is worth knowing before treating the split as the end of the
work.** The pure functions became coverable and were covered; the defect that
survived longest afterwards was in the I/O seam the split deliberately left
outside them — the gate read its head from the pull request object rather than
from the ref, so it judged a revision that was no longer current. Measured on
this document's own pull request: same PR, same minute, `CLEAN` from the stale
source and `MISSING REVIEW AT HEAD` from the ref.

A seam with no tests is where the next defect lives, and separating concerns
tells you exactly where that seam is. Test what you can, then go and look at
what is left.

That placement is the finding, not a filing preference. This section originally
carried the gate as a runnable snippet, and it was wrong in eight successive
ways that each read as working code — `gh api --jq --arg`, which that endpoint
does not accept and which sent both queries down their failure branch; a
`printf` on an empty variable that made a clean review count as one finding;
review IDs computed and never joined, so every earlier round's findings counted
against the current head forever; a `jq` invocation that printed `NOT CLEAN` and
exited 0. Every one was caught by a reviewer executing it mentally, one per
round. **Shell inside Markdown cannot be run, so review is its only control**,
and that is the same defect this file describes: an instrument nothing exercises
reporting a pass.

The properties, each earned by a version that got it wrong:

- **Identify the reviewer by its COMPLETE login**, `...[bot]` suffix included.
  Equality on the un-suffixed name returns zero, byte-identically to "not yet
  reviewed"; a substring match accepts any login containing the word, so anyone
  able to comment can present a clean-looking verdict.
- **Read `pulls/$PR/reviews`, not `pulls/$PR/comments`.** The latter returns
  only inline comments, and a clean review has none — so the outcome being
  waited for is the one that endpoint cannot report.
- **`state` is not a verdict.** Measured across four rounds here it read
  `COMMENTED` at six findings and at one, and this connector never emits
  `APPROVED`.
- **Do not reconstruct rounds from review objects.** Codex posts ONE object per
  round carrying many comments; CodeRabbit posts one object PER FINDING — six
  at a single commit. "The latest review" is a whole round for one and a single
  finding for the other, so no per-object rule is right for both.
- **Ask the two questions directly instead.** COVERAGE: did each required
  reviewer submit a review at this head that still stands? A `DISMISSED` review
  is one GitHub explicitly invalidated and it opens no thread, so counting it
  clears the gate on a review that no longer says anything. Grant coverage from
  a NAMED set of states rather than withholding it from one, so a state this
  code has not met refuses instead of counting. OUTSTANDING WORK: how many review
  threads are UNRESOLVED? GitHub already tracks the second, it is bot-agnostic,
  and it survives several reviews at one SHA. Counting findings was always a
  proxy for it.
- **Resolve the head from the REF, not from the pull request object.**
  `gh pr view --json headRefOid` lags a push — measured a full commit behind
  while `git ls-remote origin refs/heads/<branch>` was already correct. A gate
  reading it certifies the revision BEFORE the one you are about to merge, and
  a recheck that also reads `headRefOid` compares one stale value to another
  and never fires. Resolve `headRefName` from `gh`, then the SHA from
  `ls-remote`, after a fetch — and for a CROSS-REPOSITORY pull request, against
  the fork rather than `origin`. The base repository does not own a
  contributor's head ref, so `ls-remote origin` there returns nothing, or worse
  returns an unrelated branch of the same name and the gate inspects a revision
  belonging to somebody else. Resolve `headRepositoryOwner` and
  `headRepository`, as `verifying-merged-work.md` already does for its tail
  check.
- **Fail closed, and REFUSE rather than report.** Every query failing means the
  answer is unavailable, which is not a clean one; and a verdict that is printed
  but not connected to an exit status lets the caller walk on.

## Where this stops and the other file starts

The last action before merging is re-reading the head's check conclusions, not
the first. `verifying-merged-work.md` carries the merge gate itself —
`gh pr merge --match-head-commit "$VERIFIED"`, which makes the check and the
merge one atomic operation — along with the stranded-tail screen and everything
about verifying by content.

**Its "was the job green?" step reads the MERGE commit's check-runs and this
file reads the PR head. Both are right, and the difference is the phase rather
than a disagreement.** Before merging there is no merge commit — the
`merge_commit_sha` an open PR reports is GitHub's own test-merge, which nothing
runs against and which returned zero rows when measured. After merging, the
squash lands on `main` and `push: branches: [main]` runs against it, so the
merge commit is the one carrying the verdict. Read the head to decide whether to
merge; read the merge commit to decide whether `main` is healthy.

**`--match-head-commit` is not a boundary around the VERDICT, and this file
should not let it read as one.** The flag makes the server refuse when the head
has moved, which closes the push race. It says nothing about review or check
state: a bot posting a finding between the last verdict query and the merge
leaves the head untouched, so the merge succeeds with an unresolved thread
seconds old. The window is narrow and it is real, and every gate described here
sits inside it.

The mechanism has to invalidate on the event that actually occurs, and the
obvious candidate does not. **Required approval with stale approvals dismissed
on push does NOT close this**: a late bot finding arrives as a `COMMENTED`
review, which is neither a new commit nor an approval, so it dismisses nothing
and the merge proceeds carrying it. Two settings do cover it — requiring
CONVERSATION RESOLUTION before merging, which a new unresolved thread
immediately violates, or a required check that the verdict process itself
updates. Until one of those is configured, the honest description of everything
above is a LOOK taken shortly before merging, not a boundary. Say which one you
have.


Note that its procedure and this one fail in opposite directions, which is why
neither substitutes for the other. Content-verification confirmed #766 had
landed correctly while two `Integration` jobs were red on its head; status
verification would have passed a PR whose fix was stranded on the branch. Run
both — but not from the same commit, which the concluding line of an earlier
draft got wrong. **Content verification is anchored to the MERGE commit; CI and
review verification stay anchored to the PR HEAD you captured before merging.**
The measurement above is why: this repository's PR checks attach to the head,
and the merge SHA returned zero rows, so asserting required jobs "from the merge
commit" examines an empty set — or, after `main` moves, someone else's
post-merge checks. Require `success` from the jobs that commit's scope decision
says should have run, read at the head.
