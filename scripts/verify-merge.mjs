/**
 * Decides whether a pull request may merge, and whether a merged one landed
 * whole.
 *
 * `.claude/rules/verifying-merged-work.md` describes the same procedure in
 * prose with runnable shell in it. Shell embedded in a document has nothing
 * executing it, and every way it can be wrong here looks like a pass: a count
 * computed and never read, an exit status swallowed by a pipeline, a comparison
 * against a base that moves. A gate whose failure mode is a false clean has to
 * be the kind of thing a test can hold inputs against.
 *
 * So the decisions live here as pure functions, and every I/O call stays in the
 * caller: a function that fetches cannot be handed the case it must get right.
 *
 * ## What this does NOT cover
 *
 * Stated because a gate's worst failure is being trusted past its range, and a
 * reader who knows only what it checks will assume the rest.
 *
 * - **It is a point-in-time snapshot, not a lock.** Threads, check-runs and
 *   statuses are read once. A thread reopened, or a check rerun, after its query
 *   and before the exit is not seen: the freshness comparison at the end covers
 *   the revision and the pull request's own mutable fields, not every input a
 *   blocker was derived from. `gh pr merge --match-head-commit <tip>` is what
 *   makes the merge itself refuse a moved head; nothing here can hold the rest
 *   of GitHub still.
 *
 * - **`REQUIRED_CHECKS` is a floor, not a proof.** It names the workflows whose
 *   absence is known to mean no coverage. Others in `.github/workflows` are
 *   path-triggered and are judged only when they report, so a workflow that
 *   fails to create its check-runs is invisible here unless it is listed. Adding
 *   one is deliberate work; the list does not derive itself.
 *
 * - **A retained commit status is accepted as current.** The title check runs on
 *   `edited` as well as on a push, and GitHub keeps the previous successful
 *   status until the rerun replaces it — so a title edited without moving the
 *   head can be judged on the status of the title it replaced.
 *
 * - **`refs/pull/N/merge` is resolved, not pinned.** A base branch advancing
 *   mid-run can change which revision that ref names, and the filter would then
 *   be read from a revision other than the one the checks ran on.
 *
 * - **"Landed whole" screens; it cannot certify.** A mutable remote ref cannot
 *   answer "no commit ever existed here outside the merge", so an empty
 *   candidate list means this look found nothing, never that nothing was lost.
 *
 * The project runs this ADVISORY: a session invokes it, and merging is still a
 * human decision. That is why the limits above are acceptable rather than
 * defects — each narrows a window that a merge precondition, not this script,
 * is what closes.
 */

/**
 * Timeline events that replace a branch's history.
 *
 * A force-push, a deletion, and a deletion followed by recreation all leave the
 * branch reading as ordinary while the commits that were on it are gone. The
 * range check then compares a head against itself and reports nothing missing,
 * which is indistinguishable from a branch that never had a tail.
 *
 * The list is a FLOOR rather than a proof. A mutable remote ref observed over
 * several round trips cannot support "no commit ever existed here outside the
 * merge", so this exists to disqualify the cases we know of, not to certify the
 * rest.
 */
/** A git object name in full. Anything shorter is an abbreviation. */
export const FULL_SHA_LENGTH = 40;

export const HISTORY_REWRITE_EVENTS = Object.freeze([
  "head_ref_force_pushed",
  "head_ref_deleted",
  "head_ref_restored",
]);

/**
 * Total history-rewrite events across every page of a timeline.
 *
 * Takes the pages rather than fetching them, and takes them as already-parsed
 * arrays: the GitHub timeline is paged at 100 and long pull requests here reach
 * three pages, so a caller that reads only the first gets zero — the
 * reassuring answer — for a branch whose history was rewritten on page two.
 */
export function countRewriteEvents(pages) {
  if (!Array.isArray(pages)) {
    throw new TypeError("countRewriteEvents needs an array of timeline pages");
  }
  // A page that is not an array is a page that was not read. `[events, null]`
  // survives the check above, `flat()` carries the bad value through, and the
  // optional access then ignores it — so a partly unreadable timeline counts
  // zero rewrites and reports the branch as checkable. That is the exact
  // direction this module exists to refuse.
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new TypeError("countRewriteEvents needs every page to be an array");
    }
  }
  return pages
    .flat()
    .filter(event => HISTORY_REWRITE_EVENTS.includes(event?.event)).length;
}

/**
 * Whether the branch can answer "did every commit land" at all.
 *
 * Returns a REASON rather than a boolean, because every caller so far has
 * wanted to print why. Collapsing it to a boolean is how "I could not look"
 * becomes "nothing to see", which is the failure this whole file exists to
 * separate.
 */
export function checkability({ tip, rewriteEvents }) {
  if (typeof tip !== "string" || tip.length === 0) {
    // An absent tip has three causes and only one is genuinely unanswerable:
    // the branch was deleted, the pull request came from a fork whose branch
    // was never on this remote, or the name given did not resolve. A name typed
    // from memory produces this as readily as a deletion, and did.
    return { checkable: false, reason: "no-ref" };
  }
  if (!Number.isInteger(rewriteEvents) || rewriteEvents < 0) {
    // Unreadable is not zero. A failed timeline query that degrades to 0 turns
    // the guard off exactly when it cannot see.
    return { checkable: false, reason: "rewrite-count-unknown" };
  }
  if (rewriteEvents > 0) {
    return { checkable: false, reason: "history-rewritten" };
  }
  return { checkable: true, reason: "ok" };
}

/**
 * A check-run's conclusion, reduced to whether it may be counted as passing.
 *
 * `skipped` passes because a job skipped by a condition is how this repository
 * expresses "this commit cannot affect me". `neutral` passes for the same
 * reason: GitHub accepts both for a required status check, so refusing them
 * would make this gate stricter than the protection it claims to model and
 * block a revision the platform considers mergeable.
 * Everything else that is not `success` does NOT pass — including `queued` and
 * `in_progress`, which are the ones that get miscounted: filtering for
 * `conclusion === "failure"` and finding none reads as green while nothing has
 * run. One merge commit here had four required jobs queued for hours and two
 * unrelated ones completed, and answered zero failures throughout.
 */
const PASSING_CONCLUSIONS = Object.freeze(["success", "skipped", "neutral"]);

export function jobPasses(run) {
  return PASSING_CONCLUSIONS.includes(run?.conclusion);
}

/**
 * The jobs standing between a revision and a merge, named rather than counted.
 *
 * A count cannot be acted on. "3 not green" sends the reader to the web UI;
 * a name tells them whether it is theirs, which is the difference between
 * attributing a red and inheriting one.
 */
export function blockingJobs(checkRuns) {
  if (!Array.isArray(checkRuns)) {
    throw new TypeError("blockingJobs needs an array of check-runs");
  }
  return checkRuns
    .filter(run => !jobPasses(run))
    .map(run => ({
      name: run?.name ?? "(unnamed)",
      status: run?.status ?? "unknown",
      conclusion: run?.conclusion ?? null,
    }));
}

/**
 * Whether a review verdict belongs to the revision being merged.
 *
 * A verdict describes the tree it read. Carried forward to a later push it is
 * an opinion about a revision nobody is merging, and it reads exactly like an
 * opinion about this one. Compared by prefix because the bots report a short
 * sha and the ref reports a full one.
 */
export function verdictCoversTip(reviewedSha, tip) {
  if (typeof reviewedSha !== "string" || reviewedSha.length === 0) return false;
  if (typeof tip !== "string" || tip.length === 0) return false;
  // Deliberately ASYMMETRIC. The bot reports an abbreviated sha and the ref
  // reports a full one, so only the VERDICT may be short. A symmetric
  // comparison accepts a TRUNCATED tip whenever it prefixes a full reviewed
  // sha, which would let the gate pass without ever identifying the head
  // revision — the one thing it exists to pin.
  if (tip.length < FULL_SHA_LENGTH) return false;
  // Seven is git's own floor for an abbreviation that identifies a commit.
  if (reviewedSha.length < 7 || reviewedSha.length > tip.length) return false;
  return tip.startsWith(reviewedSha);
}

/**
 * Whether a reviewer looked at all, kept separate from what it found.
 *
 * Zero findings and zero reviews render identically in every count-based gate,
 * and one of them means nothing was checked. This repository's second reviewer
 * runs on a per-developer quota shared by every concurrent session, so it
 * silently stops reviewing under exactly the conditions that produce the most
 * pull requests.
 */
export function reviewCoverage(reviewCount) {
  if (!Number.isInteger(reviewCount) || reviewCount < 0) return "unknown";
  return reviewCount === 0 ? "not-reviewed" : "reviewed";
}

/**
 * The merge gate: every blocker, or an empty list.
 *
 * Returns them all rather than the first, so one round of fixing clears the
 * gate instead of revealing the next reason a merge was never going to happen.
 */
export function gateVerdict({
  tip,
  unresolvedThreads,
  checkRuns,
  changedPaths,
  required,
  eligibility,
  codexReviewedSha,
  coderabbitReviewCount,
  approvalCount = 0,
}) {
  const blockers = [];

  if (typeof tip !== "string" || tip.length === 0) {
    blockers.push({ kind: "no-tip", detail: "no head revision to merge" });
  }

  if (!Number.isInteger(unresolvedThreads) || unresolvedThreads < 0) {
    // Unknown is not zero, for the same reason everywhere else in this file.
    blockers.push({
      kind: "threads-unknown",
      detail: "could not read review threads",
    });
  } else if (unresolvedThreads > 0) {
    blockers.push({
      kind: "unresolved-threads",
      detail: `${unresolvedThreads} unresolved review thread(s)`,
    });
  }

  if (!Array.isArray(checkRuns)) {
    blockers.push({
      kind: "checks-unknown",
      detail: "could not read check-runs",
    });
  } else if (checkRuns.length === 0) {
    // No jobs at all is not a pass. It is the shape of a run that never
    // started, and a pull request has merged here in exactly that state.
    blockers.push({
      kind: "no-checks",
      detail: "no check-runs reported for this revision",
    });
  } else {
    for (const name of missingRequired(checkRuns, changedPaths, required)) {
      blockers.push({
        kind: "required-check-absent",
        detail: `${name} has no check-run AS OF this reading — either it never triggered, or it has not registered yet`,
      });
    }
    for (const job of blockingJobs(checkRuns)) {
      blockers.push({
        kind: "job-not-green",
        detail: `${job.name} (${job.status}/${job.conclusion ?? "-"})`,
      });
    }
  }

  // GitHub will not merge either of these, so a gate that reports the revision
  // as mergeable is describing something that cannot happen. Neither is visible
  // in checks or threads: a closed pull request keeps its green head checks, and
  // a draft never loses them.
  if (eligibility?.draft === true) {
    blockers.push({ kind: "draft", detail: "pull request is a draft" });
  }
  if (eligibility?.state === "closed" && eligibility?.merged !== true) {
    blockers.push({ kind: "closed", detail: "pull request is closed unmerged" });
  }

  if (!verdictCoversTip(codexReviewedSha, tip)) {
    blockers.push({
      kind: "verdict-stale",
      detail: `no review verdict for ${typeof tip === "string" ? tip.slice(0, 9) : "(unknown)"}`,
    });
  }

  return {
    mergeable: blockers.length === 0,
    blockers,
    // Reported, never a blocker. The project's decision is to run with one
    // reviewer and know it, rather than to treat its silence as coverage.
    secondReviewer: reviewCoverage(coderabbitReviewCount),
    // Also reported rather than enforced. CONTRIBUTING.md asks for one
    // maintainer approval before merge, and no merge in this repository
    // currently carries one — so blocking on it would refuse every pull request
    // rather than raise the bar for any. Surfacing it states the gap instead of
    // hiding it behind a green verdict or making the gate unusable.
    maintainerApproval: approvalCount > 0 ? "approved" : "none",
  };
}

/** Human-readable gate result, for a caller that prints rather than branches. */
export function formatVerdict(verdict) {
  const lines = [];
  lines.push(verdict.mergeable ? "GATE PASSED" : "GATE BLOCKED");
  for (const blocker of verdict.blockers)
    lines.push(`  - ${blocker.kind}: ${blocker.detail}`);
  if (verdict.secondReviewer !== "reviewed") {
    lines.push(
      `  ! second reviewer: ${verdict.secondReviewer} (not a blocker; not coverage either)`
    );
  }
  if (verdict.maintainerApproval === "none") {
    lines.push(
      "  ! maintainer approval: none (CONTRIBUTING asks for one; not enforced here)"
    );
  }
  return lines.join("\n");
}

/**
 * The process exit status, as a decision rather than as control flow.
 *
 * Kept here with the other decisions because the caller's `return` statements
 * are the one part of a gate nothing can hand inputs to, and this gate's
 * failures are all false cleans — the exact thing an untested branch produces.
 *
 * 0 passed, 1 blocked, 2 unsettled. The third is not a softer version of the
 * second: a caller may reasonably retry or escalate an unsettled result, and
 * must never treat it as a pass.
 */
/**
 * A git remote URL reduced to `owner/repo`, or null when it names no repository.
 *
 * Compared structurally rather than by string equality because one repository
 * has several spellings — `https://`, `git@`, `ssh://`, with or without `.git`,
 * with or without a trailing slash — and a check that misses a spelling falls
 * back to a remote that may be a different repository entirely.
 */
export function repoFromRemoteUrl(url) {
  if (typeof url !== "string") return null;
  const match =
    /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      url.trim()
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * The remote to read a pull request's head from.
 *
 * The head repository comes from the pull request, never from an assumption
 * about `origin`. Running from a fork checkout, `origin` is the fork, so a pull
 * request whose head lives in the upstream repository would resolve against a
 * same-named branch on the fork — a real, unrelated revision, whose checks and
 * reviews this gate would then report as the pull request's.
 *
 * A local remote is preferred only when it IS that repository, so configured
 * credentials and transports keep working; otherwise the canonical URL, which
 * is correct everywhere and needs no local setup.
 */
export function remoteForRepo(repoFullName, remotes) {
  if (typeof repoFullName !== "string" || repoFullName === "") return null;
  const wanted = repoFullName.toLowerCase();
  for (const [name, url, kind] of remotes ?? []) {
    // FETCH records only. A remote may push and fetch different repositories,
    // and every read here is a fetch — matching a push URL selects a remote that
    // does not hold the objects, which then fails on the operation rather than
    // on the selection and reads as a broken revision.
    if (kind !== undefined && kind !== "(fetch)") continue;
    if (repoFromRemoteUrl(url)?.toLowerCase() === wanted) return name;
  }
  return `https://github.com/${repoFullName}.git`;
}

/**
 * Whether the verdict still describes the pull request that was examined.
 *
 * Everything the gate reads is taken across many round trips and keyed to the
 * revision AND the mode observed at the start. Two things can move underneath
 * that, and only one of them is a revision:
 *
 * - the branch gains a commit, so the answers describe a revision it no longer
 *   has;
 * - the pull request MERGES, which usually leaves the tip untouched — so a tip
 *   comparison alone passes while every answer was taken in the pre-merge mode,
 *   judging the branch head with the landed-whole question never asked.
 *
 * Returns a reason rather than a boolean so the caller can say which moved.
 * Deliberately reports staleness only: adopting the new values would rubber
 * stamp exactly the unverified state this detects.
 */
export function staleVerification(before, after) {
  // Compares every key rather than naming fields. A named comparison covers
  // exactly the fields someone thought of, so extending the snapshot silently
  // leaves the new one unwatched; comparing the whole object makes the snapshot
  // itself the single place that decides what freshness means. Anything mutable
  // that reaches a blocker belongs in it.
  if (!before || !after) return "eligibility-unreadable";
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] !== after[key]) return `${key}-changed-during-verification`;
  }
  return null;
}

export function exitCode({ landedVerdict, mergeable }) {
  // Read from the landed-whole verdict alone rather than from reachability as
  // well. Reachability answers whether a BRANCH could be compared against a
  // merge, which is not a question an open pull request has: taking it directly
  // made every open branch with a force-push in its history exit 2, hiding a
  // perfectly good BLOCKED verdict behind "could not answer". `landedWhole`
  // already folds reachability in, and reports `n/a` before there is a merge.
  if (landedVerdict === "not-checkable") return 2;
  if (landedVerdict === "candidates") return 2;
  return mergeable ? 0 : 1;
}

/**
 * Slurped pages, refused unless every one of them was actually read.
 *
 * `--paginate --slurp` yields an array of pages, and a page that failed arrives
 * as `null` rather than as an error. `flat()` carries that through and the
 * optional access downstream discards it, so a partly-unread response becomes a
 * SHORTER list that looks complete: fewer changed files can turn a source change
 * into a documentation-only one and excuse every integration check.
 */
export function flatPages(pages, label, isReadablePage = Array.isArray) {
  if (!Array.isArray(pages)) {
    throw new TypeError(`${label}: expected an array of pages`);
  }
  for (const page of pages) {
    // The predicate is per-ENDPOINT because the shapes differ: files paginate
    // as bare arrays, check-runs and statuses as objects wrapping one. A single
    // "is it a non-null object" test spans both and therefore accepts neither
    // properly — an API error body like `{ message: "Bad credentials" }` passes
    // it, and is then dropped by the `?? []` downstream, so an unread page
    // carrying blockers becomes a passing gate.
    if (!isReadablePage(page)) {
      throw new TypeError(`${label}: a page could not be read`);
    }
  }
  return pages;
}

/**
 * Refuses a changed-file list the API truncated.
 *
 * Silence is the failure here: a capped response carries no marker saying so,
 * and the shorter list is exactly the input that makes a source change look
 * like a documentation-only one.
 */
export function assertCompleteFileList(retrieved, reported) {
  if (!Number.isInteger(reported)) {
    throw new TypeError("changed files: the pull request reported no count");
  }
  if (retrieved < reported) {
    throw new TypeError(
      `changed files: read ${retrieved} of ${reported}; the list is truncated`
    );
  }
}

/** A paginated page that wraps its array under `key`, as the checks endpoints do. */
export function pageWrapping(key) {
  return page => Array.isArray(page?.[key]);
}

/**
 * A commit STATUS, expressed as a check-run so one rule judges both.
 *
 * GitHub has two independent surfaces and a gate that reads one sees a partial
 * picture: `amannn/action-semantic-pull-request` and CodeRabbit both report
 * through the statuses API, so a check-runs-only query calls a revision green
 * while the title check is failing. Normalising here means `jobPasses` stays
 * the single definition of passing rather than growing a second one.
 */
/**
 * Status contexts published by reviewers the gate reports rather than requires.
 *
 * Their verdict is deliberately advisory, so the status carrying it must not
 * become a blocker through the other surface.
 */
/**
 * Repository permissions that carry write access.
 *
 * Read from the collaborator permission rather than inferred from an author
 * association: in an ORGANISATION repository `MEMBER` means membership of the
 * org, which says nothing about access to this repository, so a read-only
 * member's approval would be counted as the project accepting the change. The
 * association is a label GitHub applies to the author; the permission is the
 * fact about what they may do here.
 *
 * Named rather than excluded, so a permission this code has not met refuses.
 */
export const WRITE_PERMISSIONS = Object.freeze(["admin", "maintain", "write"]);

export function hasWriteAccess(permission) {
  return WRITE_PERMISSIONS.includes(permission);
}

export const OPTIONAL_STATUS_CONTEXTS = Object.freeze(["CodeRabbit"]);

export function statusAsRun(status) {
  const state = status?.state;
  return {
    name: status?.context ?? "(unnamed status)",
    status: state === "pending" ? "in_progress" : "completed",
    // Only `success` maps to a passing conclusion; `pending`, `failure` and
    // `error` all keep a value `jobPasses` refuses.
    conclusion: state === "success" ? "success" : (state ?? null),
  };
}

/**
 * Checks that were expected and never reported at all.
 *
 * A non-empty list of check-runs is not evidence that CI ran. The workflows
 * here are independent, so a run where `ci.yml` never created its jobs while
 * `secret-scan.yml` succeeded produces a green-looking set containing no build
 * and no tests. Absence of the expected name is the only thing that separates
 * them, and absence is invisible to any filter over what IS present.
 */
export function missingRequired(checkRuns, changedPaths, required) {
  if (!Array.isArray(required)) {
    throw new TypeError("missingRequired needs the required-check list");
  }
  if (!Array.isArray(checkRuns)) {
    throw new TypeError("missingRequired needs an array of check-runs");
  }
  const present = new Set(checkRuns.map(run => run?.name));
  return required
    .filter(check => workflowApplies(check.pathsIgnore, changedPaths))
    .map(check => check.name)
    .filter(name => !present.has(name));
}

/**
 * One segment of a workflow path filter, as a regular expression source.
 *
 * `**` spans directory separators and `*` stops at one, which is what makes
 * `**​/*.md` and `*.md` different patterns rather than spellings of each other.
 */
function globSegmentSource(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` spans zero OR MORE directories, so `**/*.md` matches a root
        // README as well as a nested one. Requiring the separator made the gate
        // demand integration checks the workflow deliberately never created,
        // which does not merely over-require: those checks can never appear, so
        // a documentation-only pull request could never pass at all.
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return source;
}

/** Whether one changed file is covered by one workflow path filter. */
export function pathMatches(glob, path) {
  if (typeof glob !== "string" || typeof path !== "string") return false;
  return new RegExp(`^${globSegmentSource(glob)}$`).test(path);
}

/**
 * Whether a workflow filtered by `paths-ignore` runs for this change set.
 *
 * GitHub skips such a workflow only when EVERY changed file matches a pattern,
 * so one unmatched file is enough to make it run — and therefore enough to make
 * its absence from the check-runs a finding rather than an expected quiet.
 *
 * Unreadable input answers `true`. The whole purpose of the caller is to notice
 * a check that never reported, so an unknown change set must require the check
 * and be argued with, rather than excuse it and be believed.
 */
/** How many files GitHub's own path filtering looks at, and no more. */
export const PATH_FILTER_WINDOW = 300;

/** Past this many commits GitHub runs the workflow without evaluating filters. */
export const PATH_FILTER_COMMIT_LIMIT = 1000;

/**
 * The paths a workflow's filters are actually evaluated against.
 *
 * Two platform limits, and only one of them applies in both modes.
 *
 * The 300-file window is a property of filter evaluation itself, so it holds
 * whichever event produced the run.
 *
 * The 1000-commit bypass is a property of the PULL REQUEST's diff. After a
 * merge the checks come from a `push` of the squash commit — one commit,
 * whatever the pull request contained — so applying the pull request's count
 * there answers with a number belonging to an event that is over. It would
 * empty the path list on any large pull request and require every workflow
 * regardless of what the push actually triggered.
 */
export function pathsForFiltering({ changedPaths, commits, merged }) {
  if (!Array.isArray(changedPaths)) return [];
  if (!merged && commits > PATH_FILTER_COMMIT_LIMIT) return [];
  return changedPaths.slice(0, PATH_FILTER_WINDOW);
}

export function workflowApplies(pathsIgnore, changedPaths) {
  if (!Array.isArray(pathsIgnore) || pathsIgnore.length === 0) return true;
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return true;
  return changedPaths.some(
    path => !pathsIgnore.some(glob => pathMatches(glob, path))
  );
}

/**
 * The `paths-ignore` globs a workflow declares under one trigger.
 *
 * The gate reads the workflow itself rather than holding a copy of its filter.
 * A copy is a second implementation of the same question: it agrees on the day
 * it is written, and afterwards the workflow can be edited while the copy keeps
 * looking correct, at which point the gate waits for a check that will never
 * report or excuses one that should have.
 *
 * The TRIGGER matters and is not interchangeable. Before a merge the checks come
 * from the `pull_request` run; after one they come from `push` to the base
 * branch, and the two blocks are edited independently. Reading whichever is
 * nearest would answer about the wrong run.
 */
export function workflowPathsIgnore(workflowText, trigger) {
  if (typeof workflowText !== "string" || typeof trigger !== "string") {
    throw new TypeError("workflowPathsIgnore needs the workflow text and a trigger");
  }
  const lines = workflowText.split("\n");
  const start = lines.findIndex(line => line.trimEnd() === `  ${trigger}:`);
  if (start === -1) return [];

  const globs = [];
  let collecting = false;
  for (const line of lines.slice(start + 1)) {
    // Any line at the trigger's own indent or shallower ends the block, so a
    // filter belonging to the NEXT trigger is never read as this one's.
    if (/^ {0,2}\S/.test(line)) break;
    if (line.trim() === "paths-ignore:") {
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    const entry = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (!entry) break;
    globs.push(entry[1]);
  }
  return globs;
}

/**
 * Checks whose absence means the revision has no coverage, not that it is
 * clean, each with the filter deciding whether it was due to report.
 */
export function requiredChecks(integrationPathsIgnore, { merged = false } = {}) {
  return [
    // Every other job in `ci.yml` hangs off this one through `needs: [ci]`, so
    // if it never reported then the browser, scaffold and dev-script jobs did
    // not run either, however many unrelated workflows went green. `ci.yml`
    // filters in a job rather than at the trigger, so it always reports.
    { name: "Lint / Typecheck / Test / Build", pathsIgnore: [] },
    // Its own workflow, unfiltered, on every pull request.
    { name: "gitleaks", pathsIgnore: [] },
    // Listed for the reason this whole list exists: it is an INDEPENDENT job in
    // `ci.yml`, hanging off nothing, so removing or renaming it produces no
    // check-run for a failure check to reject - the control would disappear in
    // the same change it exists to judge, and the verdict would stay green.
    // Ungated and unfiltered, on both triggers, so it is always due to report.
    { name: "Comment convention (describes code, not process)", pathsIgnore: [] },
    // The only coverage any dialect-specific behaviour has: the unit suites
    // mock the drivers and the browser tests run on sqlite alone.
    { name: "Integration (postgres)", pathsIgnore: integrationPathsIgnore },
    { name: "Integration (mysql)", pathsIgnore: integrationPathsIgnore },
    { name: "Integration (sqlite)", pathsIgnore: integrationPathsIgnore },
    // Reports through the STATUSES surface from its own workflow, and only on a
    // pull request — a push to the base branch has no title to validate, so
    // requiring it post-merge would demand a status that is never written.
    // Judged only when present, a run that never started left the title
    // unvalidated and the gate green.
    ...(merged
      ? []
      : [{ name: "Validate PR title follows Conventional Commits", pathsIgnore: [] }]),
  ];
}


/**
 * Reviews that examined THIS revision, by the record's own `commit_id`.
 *
 * A review describes the tree it read. Counting one written against an earlier
 * revision reports a reviewer as having covered a commit it never saw — the
 * same staleness the verdict check refuses, applied to coverage rather than to
 * findings.
 */
export function reviewsCoveringTip(reviews, tip, login) {
  if (!Array.isArray(reviews)) {
    throw new TypeError("reviewsCoveringTip needs an array of reviews");
  }
  if (typeof tip !== "string" || tip.length < FULL_SHA_LENGTH) return [];
  return reviews.filter(
    r =>
      r?.user?.login === login &&
      r?.commit_id === tip &&
      SUBMITTED_REVIEW_STATES.includes(r?.state)
  );
}

/**
 * Review states that constitute coverage, re-exported from the verdict gate.
 *
 * One list, not two. Both gates ask the same question of the same API, and two
 * frozen arrays of three strings agree until somebody edits one — silently,
 * because each reads correctly on its own.
 *
 * Resolved through this file's REAL path. A bare relative specifier is resolved
 * against what the runtime holds for the main module, and under
 * `--preserve-symlinks-main` that is the SYMLINK, so the sibling is looked for
 * beside the link and the process dies before running. The entry guard below
 * accepts two URL forms for the same reason; this is its import-time half.
 *
 * The filter stays INSIDE `reviewsCoveringTip` rather than at its callers,
 * because two callers each applying their own left them disagreeing: one
 * excluded drafts and the other filtered nothing, four lines apart, so the same
 * review was coverage for one reviewer and not the other.
 */
const verdict = await import(
  pathToFileURL(
    join(dirname(realpathSync(fileURLToPath(import.meta.url))), "ci-verdict.mjs")
  ).href
);
export const SUBMITTED_REVIEW_STATES = verdict.SUBMITTED_REVIEW_STATES;

/**
 * Whether the merge took everything the branch had.
 *
 * Takes the candidate commits rather than running git, so the interesting
 * cases can be handed to it. `checkable` comes from {@link checkability}: a
 * branch whose history was rewritten, or whose ref does not resolve, cannot
 * answer this at all — and an empty candidate list from an unanswerable branch
 * is not evidence of anything.
 */
export function landedWhole({ checkable, reason, candidates }) {
  if (!checkable) return { verdict: "not-checkable", reason, candidates: [] };
  if (!Array.isArray(candidates)) {
    throw new TypeError("landedWhole needs an array of candidate commits");
  }
  if (candidates.length === 0) {
    return { verdict: "no-candidates", reason: "ok", candidates: [] };
  }
  // Deliberately NOT "lost". The range says only "absent from the merged
  // head", and a surviving branch also collects force-pushes, rebases and
  // follow-up work. Each named commit is worth confirming by content against
  // the merge commit; the screen produces the list, never the verdict.
  return { verdict: "candidates", reason: "absent-from-merge", candidates };
}

// ---------------------------------------------------------------------------
// The I/O shell.
//
// Everything above is pure so it can be handed the inputs whose answers are
// known. This part does the fetching, and is deliberately thin: it reads, it
// hands the values to the functions above, and it prints. No decision is taken
// here, because a decision taken here is one no test can reach — which is the
// arrangement this whole file exists to end.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = "nextlyhq/nextly";

/** Set by `main` once the head repository is known; a fork keeps its own. */
let REMOTE_FOR_FETCH = "origin";

/**
 * Where the BASE repository's objects live.
 *
 * `refs/pull/N/merge` and a squash commit belong to the base repository even
 * when the branch does not, so they are fetched from here rather than from the
 * head remote, which for a fork holds neither.
 *
 * Resolved rather than assumed, through the same function as the head remote.
 * `origin` names the base repository only in a checkout of that repository; in
 * a fork's checkout it is the fork, which holds neither of these objects.
 */
let BASE_REMOTE = "origin";

/**
 * `gh api`, raw. Throws on failure rather than degrading to an empty result.
 *
 * `--jq` prints the filter's output verbatim, NOT as JSON: a string comes back
 * unquoted and an absent value comes back as an empty line. Parsing everything
 * as JSON therefore fails on exactly the case that matters — a pull request
 * with no review verdict yet.
 */
function ghText(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/** `gh api` where the result really is JSON. Empty output is a failure, not an empty value. */
function ghJson(args) {
  const text = ghText(args);
  if (text === "")
    throw new Error(`gh returned nothing for: ${args.join(" ")}`);
  return JSON.parse(text);
}

/**
 * Every page of the timeline, each page kept SEPARATE.
 *
 * `--paginate` concatenates the pages' arrays into one stream of JSON values,
 * so they are split back apart here: `countRewriteEvents` refuses a page it
 * cannot read, and flattening first would throw that distinction away.
 */
function timelinePages(pr) {
  // `--slurp` returns ONE array of pages, so the pages stay separate without
  // this code parsing JSON itself. Splitting `--paginate`'s concatenated arrays
  // by counting brackets does not work here: a `[` inside any review body
  // leaves the depth never returning to zero, which yields no pages at all and
  // therefore counts zero force-pushes — a false clean produced by the check
  // that exists to refuse them.
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${REPO}/issues/${pr}/timeline?per_page=100`,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    )
  );
}

/** `git`, for the two places this shell needs it. */
function run(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Commits the ref has that the merged head does not. */
function ghLog(merged, tip) {
  const out = execFileSync("git", ["log", "--oneline", `${merged}..${tip}`], {
    encoding: "utf8",
  }).trim();
  return out ? out.split("\n") : [];
}

/**
 * A file as it stood at one revision, fetched first so the read cannot silently
 * fall back to whatever the working tree happens to hold.
 */
function workflowAt(revision, path) {
  // Base repository, not the head one. `refs/pull/N/merge` and the squash commit
  // are objects of the BASE repository; a fork holds neither, so fetching them
  // from the head remote fails on every cross-repository pull request. The head
  // remote answers a different question — where the branch lives — and the two
  // coincide only when the pull request is not from a fork.
  run(["fetch", BASE_REMOTE, revision, "--quiet"]);
  // Read through FETCH_HEAD rather than by the name fetched. `git fetch <remote>
  // refs/pull/N/merge` does not create a local ref of that name, so naming it in
  // `git show` fails with `invalid object name` — for a plain sha it happens to
  // work, which is what let this pass everywhere except the one revision the
  // pre-merge path actually uses.
  return execFileSync("git", ["show", `FETCH_HEAD:${path}`], {
    encoding: "utf8",
  });
}

/**
 * Approvals from accounts that actually hold write access here.
 *
 * One request per distinct approver, cached, because a pull request with many
 * reviews would otherwise ask about the same account repeatedly. A lookup that
 * fails is treated as NOT write access: an approval this code could not verify
 * is not one it may count, and the only consequence is the advisory line
 * reporting `none`, which is the direction that understates rather than
 * invents.
 */
function countWriteAccessApprovals(reviews) {
  const seen = new Map();
  let count = 0;
  for (const review of reviews) {
    if (review?.state !== "APPROVED") continue;
    const login = review?.user?.login;
    if (typeof login !== "string" || login === "") continue;
    if (!seen.has(login)) {
      let permission = null;
      try {
        permission = ghText([
          "api",
          `repos/${REPO}/collaborators/${login}/permission`,
          "--jq",
          ".permission",
        ]);
      } catch {
        permission = null;
      }
      seen.set(login, hasWriteAccess(permission));
    }
    if (seen.get(login)) count += 1;
  }
  return count;
}

/** Every configured remote as `[name, url]`, for matching against the head repository. */
function configuredRemotes() {
  const out = execFileSync("git", ["remote", "-v"], { encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .map(line => line.split(/\s+/))
    .map(([name, url, kind]) => [name, url, kind]);
}

/** The branch's real tip, from the ref rather than from the API's cached head. */
function lsRemoteTip(remote, branch) {
  const out = execFileSync(
    "git",
    ["ls-remote", remote, `refs/heads/${branch}`],
    {
      encoding: "utf8",
    }
  );
  return out.split("\t")[0] ?? "";
}

/** Runs the gate for one pull request and prints why, exiting non-zero when blocked. */
export function main(argv) {
  const pr = argv[0];
  if (!pr || !/^\d+$/.test(pr)) {
    process.stderr.write("usage: node scripts/verify-merge.mjs <pr-number>\n");
    return 2;
  }

  const meta = ghJson([
    "api",
    `repos/${REPO}/pulls/${pr}`,
    "--jq",
    "{cross:.head.repo.full_name!=.base.repo.full_name,repo:.head.repo.full_name,branch:.head.ref,merged:.merged,mergeSha:.merge_commit_sha,head:.head.sha,state:.state,draft:.draft,changedFiles:.changed_files,baseRepo:.base.repo.full_name,commits:.commits}",
  ]);
  const remotes = configuredRemotes();
  REMOTE_FOR_FETCH = remoteForRepo(meta.repo, remotes);
  BASE_REMOTE = remoteForRepo(meta.baseRepo, remotes);
  const tip = lsRemoteTip(REMOTE_FOR_FETCH, meta.branch);

  // `.merged`, never the presence of `.merge_commit_sha`. GitHub populates that
  // field on OPEN pull requests too, with the throwaway commit from its
  // mergeability test — so keying off it would send every open PR down the
  // post-merge path and judge it on a commit that is not in anyone's history.
  const merged = meta.merged === true;

  // Which revision the checks belong to is the whole difference between the two
  // questions this script answers.
  //
  // Before merging, the branch tip is the thing being proposed and the thing CI
  // ran on. After merging, the squash commit is a DIFFERENT TREE — `main` plus
  // this change — and it is the one that decides whether `main` is green. A
  // head can be green while the merge commit is red, so reading the head after
  // the merge reports on a tree nobody has.
  const subject = merged ? meta.mergeSha : tip;

  // Only read before it is needed. Rewrite reachability answers whether a merge
  // took the whole branch, which an open pull request has not yet asked — so
  // querying it there lets an unrelated endpoint failure refuse a verdict the
  // gate could otherwise give.
  const reach = merged
    ? checkability({ tip, rewriteEvents: countRewriteEvents(timelinePages(pr)) })
    : { checkable: true, reason: "not-merged" };

  // Only after a merge is there a merge to have lost anything. Run before one,
  // this compares the API's cached head against the ref and reports ordinary
  // in-flight pushes as candidates.
  let candidates = [];
  if (merged && reach.checkable && meta.head && meta.head !== tip) {
    run(["fetch", REMOTE_FOR_FETCH, tip, "--quiet"]);
    candidates = ghLog(meta.head, tip);
  }
  const landed = merged
    ? landedWhole({ ...reach, candidates })
    : { verdict: "n/a", reason: "not merged", candidates: [] };

  // Paginated. `per_page=100` alone caps the response at one page, so a
  // revision with more than 100 runs hid every later one from `blockingJobs` —
  // a queued or failed job on page two simply not existing as far as the gate
  // was concerned.
  const checkRuns = subject
    ? flatPages(
        ghJson([
          "api",
          "--paginate",
          "--slurp",
          `repos/${REPO}/commits/${subject}/check-runs?per_page=100`,
        ]),
        "check-runs",
        pageWrapping("check_runs")
      ).flatMap(page => page.check_runs ?? [])
    : [];

  // Every file the pull request touches, so a check that was never due to run
  // is not reported as one that failed to. Paginated: a change set larger than
  // one page would otherwise look small enough to have skipped a workflow.
  const changedPaths = flatPages(
    ghJson([
      "api",
      "--paginate",
      "--slurp",
      `repos/${REPO}/pulls/${pr}/files?per_page=100`,
    ]),
    "changed files"
  )
    .flat()
    .map(file => file?.filename)
    .filter(name => typeof name === "string");

  // The endpoint stops at 3000 files however it is paginated, and a truncated
  // list is indistinguishable from a complete one. If the part returned happens
  // to be documentation while a source file falls past the cap, every
  // integration check is excused. Compared against the count the pull request
  // itself reports.
  assertCompleteFileList(changedPaths.length, meta.changedFiles);

  // GitHub evaluates path filters over the FIRST 300 files of its generated
  // diff and no further. Judging every path would diverge from the decision the
  // platform actually made: where the first 300 are all ignored, the workflow is
  // skipped and creates no check-runs, so requiring one on the strength of file
  // 301 demands a check that can never arrive.
  // Past 1000 commits GitHub stops evaluating path filters and runs the
  // workflow regardless, so deciding from paths there would excuse a check that
  // did run. An empty list makes every workflow applicable, which is the
  // direction that requires evidence.
  const filterPaths = pathsForFiltering({
    changedPaths,
    commits: meta.commits,
    merged,
  });

  // Read from the workflow, for the trigger whose run produced the checks being
  // judged: `pull_request` before a merge, `push` to the base branch after one.
  // The two blocks are edited independently, so answering from the wrong one
  // waits for a check that will never report or excuses one that should have.
  // From the revision being judged, not from the working tree. The two differ
  // whenever the checkout has moved on, and this command is expected to run
  // outside the pull request's worktree: a later commit adding a path to
  // `paths-ignore` would otherwise excuse checks that an older merge was
  // genuinely due to create.
  // Pre-merge the workflow runs from `refs/pull/N/merge` — the branch combined
  // with the CURRENT base — not from the branch tip. A base that has since
  // stopped ignoring a path would otherwise be judged with the head's older
  // filter, excusing integration runs that were genuinely due. Post-merge the
  // squash commit IS the revision the push workflow ran on.
  const filterRevision = merged ? subject : `refs/pull/${pr}/merge`;
  const integrationIgnore = workflowPathsIgnore(
    workflowAt(filterRevision, ".github/workflows/integration.yml"),
    merged ? "push" : "pull_request"
  );
  const required = requiredChecks(integrationIgnore, { merged });
  // Paginated. A pull request with more than 100 review threads would
  // otherwise have everything past the first page counted as resolved, which
  // is the reassuring direction.
  let threads = 0;
  let cursor = null;
  for (;;) {
    const after = cursor ? `, after: "${cursor}"` : "";
    const page = JSON.parse(
      ghText([
        "api",
        "graphql",
        "-f",
        `query=query { repository(owner:"nextlyhq",name:"nextly"){ pullRequest(number:${pr}){ reviewThreads(first:100${after}){ pageInfo { hasNextPage endCursor } nodes { isResolved } } } } }`,
        "--jq",
        "{n:[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)]|length, more:.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage, cur:.data.repository.pullRequest.reviewThreads.pageInfo.endCursor}",
      ])
    );
    threads += page.n;
    if (!page.more) break;
    // A cursor that does not advance would loop for ever, re-reading one page
    // and adding its count each time. Both failures are silent in opposite
    // directions — the process hangs, or an inflated count blocks a clean pull
    // request — so an absent or repeated cursor stops the read instead.
    if (!page.cur || page.cur === cursor) {
      throw new Error("review threads: pagination cursor did not advance");
    }
    cursor = page.cur;
  }

  // From the review RECORD's own `commit_id`, never from a comment body. An
  // issue comment is not evidence that a review covered a commit: prose naming
  // a sha may be progress text rather than a verdict, and a real review whose
  // sha never appears in its body carries none. Only the record states which
  // tree was read.
  // `--slurp` returns an array of PAGES and cannot be combined with `--jq`,
  // so the flattening happens here rather than in the query.
  const reviews = ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${REPO}/pulls/${pr}/reviews?per_page=100`,
  ]).flat();
  const CODEX = "chatgpt-codex-connector[bot]";
  // Through the same helper the second reviewer uses. Taking the LAST record
  // instead assumes reviews complete in the order they were requested, and an
  // older-head review finishing after a current-head one then hides a verdict
  // that does cover this revision behind one that does not.
  const submitted = reviews.filter(r =>
    SUBMITTED_REVIEW_STATES.includes(r?.state)
  );
  const reviewedSha = reviewsCoveringTip(reviews, tip, CODEX).length
    ? tip
    : submitted
        .filter(r => r?.user?.login === CODEX && r?.commit_id)
        .map(r => r.commit_id)
        .pop();
  // Scoped to THIS revision: a review of an earlier one is not coverage of it.
  const coderabbit = reviewsCoveringTip(
    reviews,
    tip,
    "coderabbitai[bot]"
  ).length;

  // Commit STATUSES are a separate surface from check-runs, and this
  // repository's title check and CodeRabbit both report through it.
  // Guarded like the check-runs lookup above. Unguarded, an empty `tip`
  // produced `commits//status`, which throws before the script can print
  // NOT CHECKABLE or return its exit code — so the documented refusal became
  // a stack trace.
  // Keyed off `subject` for the same reason the check-runs are: statuses are
  // per-commit exactly as check-runs are, so leaving this one on the tip would
  // judge a merged pull request half on the merge commit and half on the branch
  // — and the half still reading the branch is the half that reports green.
  const statuses = subject
    ? flatPages(
        ghJson([
          "api",
          "--paginate",
          "--slurp",
          `repos/${REPO}/commits/${subject}/status?per_page=100`,
        ]),
        "statuses",
        pageWrapping("statuses")
      ).flatMap(page => page.statuses ?? [])
    : [];
  // An optional reviewer's own status is excluded from the blocking set. Its
  // review is reported and never blocks, so letting the status it publishes
  // reach `blockingJobs` would enforce through one surface what the verdict
  // explicitly declines to enforce through the other — and a quota exhaustion,
  // which is the common cause, would then block every pull request at once.
  const allChecks = [
    ...checkRuns,
    ...statuses
      .filter(s => !OPTIONAL_STATUS_CONTEXTS.includes(s?.context))
      .map(statusAsRun),
  ];

  const verdict = gateVerdict({
    // Deliberately the TIP even after a merge, unlike the checks above. A review
    // is written against the branch revision the reviewer read; no bot ever
    // reviews a squash commit, so comparing a verdict to `subject` post-merge
    // would report every merged pull request as unreviewed.
    tip,
    unresolvedThreads: threads,
    checkRuns: allChecks,
    changedPaths: filterPaths,
    required,
    eligibility: { state: meta.state, draft: meta.draft, merged },
    codexReviewedSha: reviewedSha,
    coderabbitReviewCount: coderabbit,
    approvalCount: countWriteAccessApprovals(reviews),
  });

  // Nothing is printed until the freshness read below has decided. Emitting the
  // verdict first meant a run that turned out to be stale had already written
  // GATE PASSED to stdout, contradicted only by a later line and the exit code —
  // which misleads a human and actively misinforms any caller that reads the
  // documented text rather than the status.
  const report =
    `PR #${pr} @ ${(subject || "").slice(0, 9) || "(no ref)"}` +
    `${merged ? ` (merge commit; branch ${tip.slice(0, 9)})` : ""}\n` +
    `  landed-whole: ${landed.verdict} (${landed.reason})\n` +
    landed.candidates
      .map(line => `    candidate, confirm by content: ${line}\n`)
      .join("") +
    `${formatVerdict(verdict)}\n`;

  // Every mutable fact a blocker depends on, read once at the start and once
  // here. The whole snapshot is compared, so a fact added to the projection is
  // covered without editing the comparison.
  const MUTABLE = "{merged:.merged,state:.state,draft:.draft}";
  const after = ghJson(["api", `repos/${REPO}/pulls/${pr}`, "--jq", MUTABLE]);
  const stale = staleVerification(
    { merged, state: meta.state, draft: meta.draft, tip },
    { ...after, tip: lsRemoteTip(REMOTE_FOR_FETCH, meta.branch) }
  );
  if (stale) {
    process.stdout.write(
      `PR #${pr}: ${stale}\n` +
        `  no verdict issued: the answers describe ${tip.slice(0, 9)} as it\n` +
        "  stood when the check began, and that is no longer current\n"
    );
    return 2;
  }

  process.stdout.write(report);

  return exitCode({
    landedVerdict: landed.verdict,
    mergeable: verdict.mergeable,
  });
}

/**
 * The executable boundary, where a failure to look becomes exit 2.
 *
 * Every helper below the pure section throws rather than degrading, which is
 * right — but an uncaught throw exits 1, and 1 is the code meaning this gate
 * examined the revision and rejected it. An expired token, an unreachable API,
 * a malformed response or a failed fetch would therefore be indistinguishable
 * from a verdict, and a caller would stop rather than retry.
 *
 * `run` is injectable so this decision can be given a failure and asked what it
 * returns; that is the only reason it is a parameter.
 */
/**
 * Every URL form `import.meta.url` might report for `process.argv[1]`.
 *
 * BOTH forms, because symlink resolution is a runtime option rather than a
 * fixed behaviour. By default `import.meta.url` is resolved through symlinks
 * while `argv[1]` is not — on macOS `/tmp` is `/private/tmp`, so comparing the
 * unresolved form there never matches. Under `--preserve-symlinks-main`, which
 * `NODE_OPTIONS` can set from outside the command line, it is the opposite: the
 * resolved form never matches.
 *
 * Committing to either one makes the guard depend on a flag this code cannot
 * see, and its failure is silent in the worst way — the module declines to run
 * and the process exits 0 having verified nothing, which is indistinguishable
 * from a clean pass.
 */
function entryHrefs(argvPath) {
  const forms = [];
  try {
    forms.push(pathToFileURL(argvPath).href);
  } catch {
    // An unconvertible path contributes nothing rather than failing the guard.
  }
  try {
    forms.push(pathToFileURL(realpathSync(argvPath)).href);
  } catch {
    // Unresolvable is not fatal either: the plain form above may still match.
  }
  return forms;
}

export function runCli(argv, run = main) {
  try {
    return run(argv);
  } catch (error) {
    process.stderr.write(
      `verify-merge: could not complete the check — ${error?.message ?? error}\n` +
        "This is exit 2 (unanswered), not a rejection. Retry, or check auth.\n"
    );
    return 2;
  }
}

if (
  process.argv[1] &&
  entryHrefs(process.argv[1]).includes(import.meta.url)
) {
  // `process.exitCode`, not `process.exit()`. Exiting terminates Node before a
  // redirected stdout finishes flushing, truncating exactly the blocker names a
  // caller needs — and the truncation is silent, so the output looks complete.
  process.exitCode = runCli(process.argv.slice(2));
}
