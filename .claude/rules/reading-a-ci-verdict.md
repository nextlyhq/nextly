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

**The one habit that covers all of them: name the jobs you require and assert
`success` on each.** Absence of `failure` is not a verdict — `queued`,
`in_progress`, `skipped` and _never triggered_ all satisfy it.

```sh
gh api "repos/nextlyhq/nextly/commits/$SHA/check-runs?per_page=100" --paginate \
  --jq '.check_runs[]|"\(.status)/\(.conclusion // "none")\t\(.name)"' \
  | sort
```

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
A full main-targeting PR here lands between 12 and 17 checks depending on which
`paths` filters its diff trips, so no fixed number separates the two cases
either. The run-level query is the discriminator; the count is not.

Ask at the workflow level instead:

```sh
gh run list --branch "$BRANCH" --limit 12 \
  --json name,status,conclusion,headSha,event \
  --jq '.[]|"\(.status)/\(.conclusion // "-")  \(.headSha[0:9])  \(.event)  \(.name)"'
```

A genuine dropped trigger shows only `pull_request_target` runs — PR Title,
Labeler — and no `pull_request` ones. A busy queue shows the `pull_request` runs
present and `queued`.

**The remedies are opposite, which is why guessing is expensive.** Any push
re-triggers a genuinely dropped run. Pushing at a queued one CANCELS the
in-flight run and re-queues it at the back, so the fix for one is the way to
lose another hour on the other.

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
`packages/ui/**` or the lockfile, a path-filtered build as well — so it can
present three to five green checks, including one that genuinely compiled
something. There is no red to notice and no obviously missing count.

**A stacked PR's CI verdict is therefore UNOBTAINABLE, not pending.** Local runs
are the only evidence until the base is `main`. Retargeting is what starts CI
rather than a formality afterwards, so retarget before gating, not after.

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

Each needs an explicit re-run:

```sh
gh run rerun "$RUN_ID"            # whole run
gh run rerun "$RUN_ID" --failed   # only the failed jobs
```

`--failed` selects nothing on a run that was CANCELLED rather than failed, and
reports success having re-run zero jobs. Check `conclusion` before choosing the
flag.

This cuts the other way too, and that is the more common error: a red inherited
from `main` is not evidence about the branch. Before working a failure, confirm
it reproduces from the branch's own diff — see `verifying-merged-work.md` on
naming the mechanism before calling something flake.

## A reviewer that never reviewed reads as a reviewer with no findings

The same shape outside CI. Both bots here can report nothing for reasons that
have nothing to do with the code.

**Match bot logins as a pattern, never by equality.** The logins carry a `[bot]`
suffix — measured on this repo's PRs:

```
chatgpt-codex-connector[bot]
coderabbitai[bot]
pkg-pr-new[bot]
```

An exact-equality filter on `chatgpt-codex-connector` returns zero and is
byte-identical to "not yet reviewed". That cost four watch cycles on #785
reporting no verdict while a clean one had been sitting there since 03:00. Use
`select(.user.login|test("codex";"i"))`.

**CodeRabbit's review limit is per-ACCOUNT and shared across every lane on this
machine.** When it is reached it posts a "Review limit reached" comment and
zero review objects, and its check goes green — so a rate-limited non-review and
a clean review render the same. Read the comment BODY, not the check colour.
Some PRs here have never received a CodeRabbit review at all.

**A verdict also names a commit, and a rebase orphans it.** Confirm the sha the
bot reviewed is still an ancestor of the head you are about to merge:

```sh
git merge-base --is-ancestor "$REVIEWED_SHA" "$HEAD_SHA"
```

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
both, from the merge commit, and require `success` by name.
