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

```sh
set -o pipefail
gh api "repos/nextlyhq/nextly/commits/$SHA/check-runs?per_page=100" --paginate \
  --jq '.check_runs[]|"\(.status)/\(.conclusion // "none")\t\(.name)"' \
  | sort || { echo "check-runs query FAILED — not clean" >&2; exit 2; }
```

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
a change touching `templates/` adds `scaffold-build.yml`'s six legs on top of
everything else. **Do not substitute one fixed number for another**; a document
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
as present. It also sweeps in unrelated `pull_request` workflows, so the list
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

Settle it by reading that workflow's `on:` block against this commit's diff, not
by looking harder at the run list. All three return the same nothing.

**Measured on this very PR**, which is the cheapest available demonstration:
`integration.yml` declares `paths-ignore: ["docs/**", "**/*.md"]`, the diff is
one `.md` file, and the workflow correctly produces no run at all. Reading that
absence as a dropped trigger would mean pushing to "fix" a filter doing its job —
and, because `ci.yml` was `queued` at that moment, the push would have cancelled
the one run that mattered.

**The remedies are opposite, which is why guessing is expensive.** Any push
re-triggers a genuinely dropped run. Pushing at a queued one CANCELS the
in-flight run and re-queues it at the back, so the fix for one is the way to
lose another hour on the other — and the fix for a path-filtered absence is to
do nothing at all.

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
`pull_request_target` checks and, whenever it happens to touch `templates/`,
`packages/ui/**` or the lockfile, path-filtered builds as well — and those carry
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

Follow it with a push or a rebase, which emits `synchronize`, or close and
reopen. Then gate on the run, never on the base having been changed.

## A failed job takes its dependents with it, silently

`ci.yml` fans out from one job:

```
changes -> ci (Lint / Typecheck / Test / Build) -> e2e            (Browser tests)
                                                -> scaffold-smoke (Scaffold smoke)
                                                -> dev-script-smoke (Dev script ...)
```

All three declare `needs: [ci]`. When `ci` fails they do not run, and a skipped
dependent looks nothing like a failure — so three jobs of coverage leave every
PR at once, reported as one red job.

Measured on PR #787's head `d243c855c`, which is what that looks like:

```
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

```
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
as approval:

```sh
# The review objects, newest last. `state` is NOT a verdict — see below.
gh api "repos/nextlyhq/nextly/pulls/$PR/reviews" --paginate \
  --jq '.[]|select(.user.login=="chatgpt-codex-connector[bot]")
        |"\(.id)\t\(.commit_id)"'

# The findings attached to each review. A review absent here carried none.
gh api "repos/nextlyhq/nextly/pulls/$PR/comments" --paginate \
  --jq '.[]|select(.user.login=="chatgpt-codex-connector[bot]")
        |.pull_request_review_id' | sort | uniq -c
```

**Ask the `reviews` endpoint, not `comments`, and this is the half that decides
whether a CLEAN verdict is visible at all.** `pulls/$PR/comments` lists review
comments — the inline ones attached to lines. A clean review has no findings and
therefore no inline comments, so that endpoint returns zero rows for it,
byte-identically to "never reviewed". The very outcome being waited for is the
one it cannot report.

`pulls/$PR/reviews` returns the review OBJECT, which exists whether or not it
carried findings, and its `commit_id` is what binds the verdict to a revision.
Paginate it: a PR with many rounds runs past one page, and an unpaginated read
answers from page one.

**But the review object does not say whether the review was CLEAN, and `state`
is the field that looks like it does.** It records the GitHub review event, not
whether the bot found anything. Measured across four consecutive rounds on this
PR:

```
review=4934719144  sha=6ddf99bd4  state=COMMENTED  findings=6
review=4934879982  sha=750063e00  state=COMMENTED  findings=3
review=4934934820  sha=8653d09ce  state=COMMENTED  findings=4
review=4935023499  sha=435af806a  state=COMMENTED  findings=1
```

Same `state` at six findings and at one. This bot never emits `APPROVED`, so a
gate reading `state` treats a finding-bearing review as a pass — and it does so
at the correct SHA, which is what makes it survive the freshness check.

**Derive cleanliness from the findings, not from a field.** A review is clean
when NO inline comment carries its `pull_request_review_id`. Join the two
queries above and require a count of zero at the head SHA before binding
`REVIEWED_SHA`.

The table is also the instrument's positive control, and it is worth keeping one
to hand: four known non-clean reviews, and the join reports 6, 3, 4 and 1 rather
than zero. A cleanliness check that has only ever been run against clean input
cannot distinguish itself from one that always answers "clean".

Compare against the whole login, or against the App identity. If a filter must
be pattern-based, anchor it — `test("^chatgpt-codex-connector\\[bot\\]$")` —
rather than leaving it open at both ends.

**CodeRabbit's review limit is per-ACCOUNT and shared across every lane on this
machine.** When it is reached it posts a "Review limit reached" comment and
zero review objects, and its check goes green — so a rate-limited non-review and
a clean review render the same. Read the comment BODY, not the check colour.
Some PRs here have never received a CodeRabbit review at all.

**A verdict names a commit, and it is evidence about THAT commit only.** Require
the reviewed sha to EQUAL the head you are about to merge:

```sh
[ "$REVIEWED_SHA" = "$HEAD_SHA" ] || {
  echo "verdict is stale for $HEAD_SHA; re-request review" >&2; exit 2
}
```

**The mismatch branch has to EXIT.** Written as `|| echo ...` the compound
command succeeds, so a script using it as the review gate prints its warning and
walks straight on to the merge — a gate that reports the problem and permits it
anyway.

**Ancestry is the tempting check and it is too weak.** After any ordinary push
the reviewed sha REMAINS an ancestor of the new head, so
`git merge-base --is-ancestor` succeeds while the commits added since were never
looked at — which is precisely the window a review gate exists to close. It
detects only history rewrites, and a rewrite is not the common case; pushing a
fix after a clean verdict is.

Where the intervening delta genuinely does not need re-review — a rebase with no
content change — say so and record which commits were exempted, rather than
letting an ancestry check make that judgement silently.

## Where this stops and the other file starts

The last action before merging is re-reading the head's check conclusions, not
the first. `verifying-merged-work.md` carries the merge gate itself —
`gh pr merge --match-head-commit "$VERIFIED"`, which makes the check and the
merge one atomic operation — along with the stranded-tail screen and everything
about verifying by content.

Note that its procedure and this one fail in opposite directions, which is why
neither substitutes for the other. Content-verification confirmed #766 had
landed correctly while two `Integration` jobs were red on its head; status
verification would have passed a PR whose fix was stranded on the branch. Run
both, from the merge commit, and require `success` from the jobs this commit's
scope decision says should have run.
