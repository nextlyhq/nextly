// The request layer the verdict gate reads its evidence through.
//
// Separated from the command because these are where the two halves of the
// program disagree about the WORLD rather than about a value: a request that
// failed, a ref that answered nothing, a fork whose branch is not on `origin`.
// None of that is reachable by importing a decision function, and running the
// whole command to reach it means every case needs a process.
//
// So the process runner is a PARAMETER. A caller supplies `execFileSync`; a
// test supplies whatever failure it wants to describe. The distinction that
// matters is between a command that failed and a command that succeeded while
// reporting nothing useful — the first announces itself, and the second is the
// one that reaches a verdict as empty evidence.

/**
 * A `gh` invocation that returns parsed JSON, or throws.
 *
 * Every query is its own process and its failure is its own exception. A
 * rejected request must reach the caller as a refusal rather than as empty
 * data: "nobody has reviewed this" and "the reviews could not be read" produce
 * the same empty array, and only one of them is a verdict.
 *
 * `--hostname` is inserted on every api call. Parsing the host out of the
 * configuration and then letting the requests default sends them to public
 * GitHub while the report claims to describe an Enterprise repository.
 */
export function createGh({ exec, host }) {
  return args =>
    JSON.parse(
      exec(
        "gh",
        args[0] === "api"
          ? ["api", "--hostname", host, ...args.slice(1)]
          : args,
        { encoding: "utf8", maxBuffer: 64e6 }
      )
    );
}

/**
 * Point git at the credentials `gh` is using, and carry on if it cannot.
 *
 * `git` does not read `GH_TOKEN`, and the workflow checks out with
 * `persist-credentials: false`, so `ls-remote` against a private repository
 * would fail after the API lookups had already succeeded.
 *
 * Deliberately swallows its failure: unauthenticated public access still
 * works, and a private repository fails later at `ls-remote` with a message
 * naming the ref it could not read. Returns whether it succeeded so a caller
 * can say so rather than having to guess.
 */
export function setupGitCredentials({ exec, host }) {
  try {
    exec("gh", ["auth", "setup-git", "--hostname", host], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The remote that HAS the pull request's branch.
 *
 * A fork's branch is not on `origin`, so reading the ref from there returns
 * nothing — or, where the base repository has a branch of the same name, an
 * unrelated revision belonging to somebody else.
 *
 * Both forms are derived from the CONFIGURED repository rather than from the
 * checkout. `origin` is whatever this working copy happens to point at, which
 * need not be the repository the configuration selected: the API data would
 * then describe one repository while the SHA came from another.
 */
export function headRemoteFor(meta, { host, repo }) {
  return meta?.isCrossRepository
    ? `https://${host}/${meta.headRepositoryOwner.login}/${meta.headRepository.name}.git`
    : `https://${host}/${repo}.git`;
}

/**
 * The branch tip, from the REF rather than from the pull request object.
 *
 * `headRefOid` lags a push — measured a full commit behind while `ls-remote`
 * was already correct — so a gate reading it certifies a revision that is no
 * longer the head, which is the class of defect this program exists to stop.
 *
 * Throws on an empty answer. `ls-remote` exits 0 for a ref that does not
 * exist, so the success status says only that the question was asked; taking
 * the first field of an empty line yields `undefined`, and a comparison
 * against `undefined` reports a moved head rather than a missing one.
 */
export function readHeadSha({ exec, headRemote, headRefName }) {
  const line = exec(
    "git",
    ["ls-remote", headRemote, `refs/heads/${headRefName}`],
    {
      encoding: "utf8",
    }
  ).trim();
  const sha = line.split(/\s+/)[0];
  if (!sha) {
    throw new Error(`no such ref on ${headRemote}: refs/heads/${headRefName}`);
  }
  return sha;
}

/**
 * How many commits the branch carries that the merge does not.
 *
 * A merged pull request keeps a branch that can still be pushed to while the
 * merged head is frozen, so commits after that point are in neither and would
 * otherwise go unnoticed.
 *
 * Both ends are fetched from the remote that HAS them: the workflow checks out
 * shallow, and after a squash the merged head is commonly absent. A shallow
 * checkout keeps its boundary in `.git/shallow`, and fetching two more objects
 * does not remove it — so `rev-list` stops at the boundary and reports a SHORT
 * count rather than failing. That is the reassuring direction: a truncated
 * range reads as a clean tail, which is exactly what this count exists to
 * disprove.
 *
 * Deepened only when the repository is actually shallow, because `--unshallow`
 * errors on a complete one.
 */
export function countStranded({ exec, headRemote, mergedHead, head }) {
  const isShallow =
    exec("git", ["rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
    }).trim() === "true";
  exec(
    "git",
    [
      "fetch",
      ...(isShallow ? ["--unshallow"] : []),
      headRemote,
      head,
      mergedHead,
    ],
    { stdio: "ignore" }
  );
  return (
    Number(
      exec("git", ["rev-list", "--count", `${mergedHead}..${head}`], {
        encoding: "utf8",
      }).trim()
    ) || 0
  );
}
