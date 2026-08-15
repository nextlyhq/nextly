// Runs `scripts/ci-verdict.mjs` AS A PROGRAM.
//
// The sibling suite imports the decision helpers and calls them. That covers
// what those functions compute, and nothing about whether the command around
// them executes: the entry guard, the request sequence, the git commands and
// the process exit are all reachable only by starting the process. A suite
// that only imports has been fully green while the command crashed on its
// first line, because no test ever ran it.
//
// So every case here spawns the real file. Two substitutions make that
// possible without a network:
//
//   `gh`  is a stub on PATH, answering from a recorded fixture. Its requests
//         are reads with stable shapes, so a recording is as good as the
//         service and it runs anywhere, including CI.
//
//   `git` is REAL, pointed at a throwaway repository by `url.<path>.insteadOf`
//         supplied through `GIT_CONFIG_COUNT`. It is deliberately NOT stubbed:
//         the counting defect this file pins comes from how a genuine shallow
//         clone answers `rev-list`, and a stub would only reproduce whatever
//         belief was written into it.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "ci-verdict.mjs");
const CODEX = "chatgpt-codex-connector[bot]";
const RABBIT = "coderabbitai[bot]";

let root;
let origin;
/** The five-commit chain, oldest first, as SHAs. */
let chain;

/**
 * A `gh` that answers from a fixture instead of the network.
 *
 * Routes are matched on argv ELEMENTS rather than on a joined string, because
 * `pulls/1` is a prefix of `pulls/1/reviews` and a substring match would let
 * one route answer both. An ambiguous or unmatched request exits non-zero
 * rather than guessing: a stub that silently picks a route turns a missing
 * fixture into a passing test.
 */
const STUB = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(process.env.GH_STUB_FIXTURE, "utf8"));
// Every invocation is recorded, so a case can assert that a request was MADE
// rather than only that its answer was accepted. Validating each call
// independently cannot see a request the command skipped: the remaining calls
// return the same fixture data either way.
appendFileSync(process.env.GH_STUB_CALLS, JSON.stringify(argv) + "\\n");
const tokens = [];
for (let i = 0; i < argv.length; i += 1) {
  // Inserted on every api request by the caller, so it does not identify one.
  if (argv[i] === "--hostname") { i += 1; continue; }
  tokens.push(argv[i]);
}
const hits = fixture.routes.filter(
  r =>
    r.when.every(t => tokens.includes(t)) &&
    !(r.unless ?? []).some(t => tokens.includes(t))
);
if (hits.length !== 1) {
  process.stderr.write("gh-stub: " + hits.length + " routes match " + JSON.stringify(tokens) + "\\n");
  process.exit(64);
}
const [route] = hits;
if (route.stderr) process.stderr.write(route.stderr);
if (route.stdout !== undefined) process.stdout.write(JSON.stringify(route.stdout));
process.exit(route.exitCode ?? 0);
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ci-verdict-cli-"));
  origin = join(root, "origin");
  mkdirSync(origin, { recursive: true });

  const git = args =>
    execFileSync("git", args, { cwd: origin, encoding: "utf8" });
  git(["init", "-q", "-b", "feature/x", "."]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
  // A developer with `commit.gpgSign=true` in their user configuration has no
  // signing key for this synthetic identity, so the fixture would fail to
  // build before any case ran. Set in the throwaway repository rather than
  // passed per commit, so it also covers any commit added here later.
  git(["config", "commit.gpgSign", "false"]);
  chain = [];
  for (let i = 0; i < 5; i += 1) {
    writeFileSync(join(origin, "f.txt"), `${i}\n`);
    git(["add", "f.txt"]);
    git(["commit", "-qm", `c${i}`]);
    chain.push(git(["rev-parse", "HEAD"]).trim());
  }

  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), STUB);
  chmodSync(join(bin, "gh"), 0o755);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** A fresh shallow clone, which is what a CI checkout gives the command. */
const shallowClone = name => {
  const path = join(root, name);
  execFileSync("git", [
    "clone",
    "-q",
    "--depth",
    "1",
    `file://${origin}`,
    path,
  ]);
  return path;
};

/**
 * A clone whose local `HEAD` sits at `sha` while the remote branch stays put.
 *
 * Full rather than shallow, because the commit being checked out is behind the
 * boundary a `--depth 1` clone would draw.
 */
const detachedClone = (name, sha) => {
  const path = join(root, name);
  execFileSync("git", ["clone", "-q", `file://${origin}`, path]);
  execFileSync("git", ["checkout", "-q", "--detach", sha], { cwd: path });
  return path;
};

/**
 * The routes every lifecycle needs, so a case states only what it varies.
 *
 * `--slurp` hands back one array per page, which the command flattens; the
 * nesting here is that page structure rather than an accident.
 */
const baseRoutes = ({
  state,
  headRefOid,
  reviews = [],
  threads = [],
  timeline = [],
  commits,
}) => [
  { when: ["auth", "setup-git"] },
  {
    // The PR number and `--repo` value are REQUIRED here, not decoration.
    // `gh pr view` with no argument resolves the current branch's pull
    // request and `--repo` selects the repository, so a route matching on the
    // command words alone accepts a call that reads lifecycle and head
    // metadata from a different pull request than the API requests use.
    when: [
      "pr",
      "view",
      "1",
      "--repo",
      "nextlyhq/nextly",
      "headRefName,isCrossRepository,headRepositoryOwner,headRepository,state,headRefOid,baseRefOid",
    ],
    stdout: {
      headRefName: "feature/x",
      isCrossRepository: false,
      headRepositoryOwner: { login: "nextlyhq" },
      headRepository: { name: "nextly" },
      state,
      headRefOid,
      baseRefOid: "base000",
    },
  },
  {
    when: [
      "pr",
      "view",
      "1",
      "--repo",
      "nextlyhq/nextly",
      "state,headRefOid,baseRefOid",
    ],
    stdout: { state, headRefOid, baseRefOid: "base000" },
  },
  { when: ["repos/nextlyhq/nextly/pulls/1/reviews"], stdout: [reviews] },
  {
    when: ["repos/nextlyhq/nextly/pulls/1"],
    stdout: { commits: commits.length },
  },
  {
    when: ["repos/nextlyhq/nextly/pulls/1/commits"],
    stdout: [commits.map(sha => ({ sha, parents: [{ sha: "p" }] }))],
  },
  { when: ["repos/nextlyhq/nextly/issues/1/comments"], stdout: [[]] },
  {
    when: ["graphql"],
    stdout: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: threads,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    },
  },
  {
    when: ["repos/nextlyhq/nextly/issues/1/timeline?per_page=100"],
    stdout: [timeline],
  },
];

const review = (login, commitId) => ({
  id: `${login}-${commitId}`,
  user: { login },
  commit_id: commitId,
  state: "APPROVED",
  submitted_at: "2026-08-15T10:00:00Z",
});

/**
 * The environment the command runs under, with every variable it READS pinned.
 *
 * Inheriting the runner's environment is not neutral here. `GH_HOST` is an
 * ordinary Enterprise setting, and the command derives its request host and its
 * git remote from it — so an inherited value sends the subprocess at a host the
 * `insteadOf` rewrite below does not intercept, and the cases either fail or
 * reach the network. `CI_VERDICT_BLOCKING` and `CI_VERDICT_ADVISORY` rename the
 * reviewers the verdict is computed from, which changes the expected answer
 * without changing the fixture.
 *
 * `NODE_OPTIONS` is pinned for the same reason in the opposite direction: the
 * symlink case SETS it, so leaving it inherited elsewhere would let a runner
 * supply the flag to every other case and quietly remove the contrast that one
 * is demonstrating.
 */
const cliEnv = ({ nodeOptions } = {}) => {
  const env = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    GH_REPO: "nextlyhq/nextly",
    NODE_OPTIONS: nodeOptions ?? "",
    // Real git, aimed at the throwaway repository. Supplied through the
    // environment so no config file anywhere is written or read.
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${origin}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/nextlyhq/nextly.git",
  };
  // Deleted rather than blanked: the command falls back to its own default
  // when these are absent, and an empty string is a configured value that
  // would override it.
  delete env.GH_HOST;
  delete env.CI_VERDICT_BLOCKING;
  delete env.CI_VERDICT_ADVISORY;
  delete env.GH_STUB_FIXTURE;
  return env;
};

/**
 * Start the command and return its status and parsed report.
 *
 * `stdout` is returned unparsed as well, because a case that exits without
 * emitting has to be able to assert on the absence rather than on a parse
 * failure that would look identical to malformed output.
 */
const runCli = ({ cwd, routes, entry = ENTRY, nodeOptions, args = ["1"] }) => {
  const fixture = join(root, "fixture.json");
  const calls = join(root, "calls.log");
  writeFileSync(fixture, JSON.stringify({ routes }));
  writeFileSync(calls, "");
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...cliEnv({ nodeOptions }),
      GH_STUB_FIXTURE: fixture,
      GH_STUB_CALLS: calls,
    },
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = undefined;
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    report,
    /** Every `gh` invocation, in order, as its argv array. */
    calls: readFileSync(calls, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line)),
  };
};

/** How many recorded invocations carry every one of `tokens`. */
const callsMatching = (calls, tokens) =>
  calls.filter(argv => tokens.every(token => argv.includes(token))).length;

// Each case spawns a clone, the command, and the several `gh` and `git`
// subprocesses it makes — measured near 4.3s against a 5s default, which is a
// margin a loaded runner erases. Raised so a slow machine reports slowness
// rather than a failure of the behaviour under test.
describe("ci-verdict as a command", { timeout: 60_000 }, () => {
  it("counts the whole tail from a shallow clone", () => {
    // The branch carries three commits the merge does not. A shallow checkout
    // stops `rev-list` at its own boundary and answers 1 — the reassuring
    // direction, since a short count reads as a clean tail. The exit status is
    // 10 either way, so the COUNT is what this asserts: a case pinned on the
    // status alone passes straight through the defect.
    const merged = chain[1];
    const tip = chain[4];
    const run = runCli({
      cwd: shallowClone("tail"),
      routes: baseRoutes({
        state: "MERGED",
        headRefOid: merged,
        reviews: [review(CODEX, tip)],
        commits: [tip],
      }),
    });
    expect(run.report?.verdict).toBe("MERGED WITH UNMERGED CANDIDATES");
    expect(run.report?.detail?.unmergedCandidates).toBe(3);
    expect(run.status).toBe(10);
  });

  it("reports a merged pull request whose branch never moved as settled", () => {
    const tip = chain[4];
    const run = runCli({
      cwd: shallowClone("settled"),
      routes: baseRoutes({
        state: "MERGED",
        headRefOid: tip,
        reviews: [review(CODEX, tip)],
        commits: [tip],
      }),
    });
    expect(run.report?.verdict).toBe("ALREADY MERGED");
    expect(run.status).toBe(0);
  });

  it("clears an open pull request reviewed at its current head", () => {
    const tip = chain[4];
    // The checkout's local HEAD is moved OFF the branch tip while the remote
    // ref stays where it is. Every clone otherwise leaves the two equal, so
    // `git rev-parse HEAD` would answer identically and the case could not
    // tell the local checkout from the configured repository's branch — which
    // is the whole thing the command has to get right, since it may run from
    // a stale or unrelated working copy.
    const run = runCli({
      cwd: detachedClone("clean", chain[0]),
      routes: baseRoutes({
        state: "OPEN",
        headRefOid: tip,
        reviews: [review(CODEX, tip)],
        commits: [tip],
      }),
    });
    expect(run.report?.verdict).toBe("CLEAN");
    expect(run.report?.head).toBe(tip);
    expect(run.status).toBe(0);
    // The verdict is computed BETWEEN two identical observations, so the
    // evidence cannot have moved while it was being decided. Every route
    // answers the same data whichever way that goes, so only counting the
    // requests can see the closing observation happen: asserting on the
    // report alone leaves the recheck removable with the suite green.
    expect(
      callsMatching(run.calls, ["pr", "view", "state,headRefOid,baseRefOid"])
    ).toBeGreaterThanOrEqual(2);
    // An advisory reviewer's absence is REPORTED but does not hold the merge,
    // so a gap stays visible without a reviewer outside the blocking set being
    // able to block on quota it never spent.
    expect(run.report?.missing_reviews).toContain(RABBIT);
  });

  it("refuses an open pull request whose review names an earlier revision", () => {
    const run = runCli({
      cwd: shallowClone("stale"),
      routes: baseRoutes({
        state: "OPEN",
        headRefOid: chain[4],
        reviews: [review(CODEX, chain[2])],
        commits: [chain[4]],
      }),
    });
    expect(run.report?.verdict).toBe("MISSING REVIEW AT HEAD");
    expect(run.status).toBe(10);
  });

  it("answers for a pull request closed without merging", () => {
    // Its branch is commonly deleted straight after, so resolving the ref
    // first turned this conclusive lifecycle into a failure to answer.
    //
    // `headRefName` names a ref the throwaway origin does NOT have, which is
    // what makes this case able to fail. Pointing it at the existing branch
    // lets an early `ls-remote` succeed and produce the same verdict, so the
    // fixture would never reach the mechanism and the case would pass on the
    // broken ordering it exists to reject.
    const run = runCli({
      cwd: shallowClone("closed"),
      routes: [
        { when: ["auth", "setup-git"] },
        {
          when: [
            "pr",
            "view",
            "1",
            "--repo",
            "nextlyhq/nextly",
            "headRefName,isCrossRepository,headRepositoryOwner,headRepository,state,headRefOid,baseRefOid",
          ],
          stdout: {
            headRefName: "feature/deleted-after-closing",
            isCrossRepository: false,
            headRepositoryOwner: { login: "nextlyhq" },
            headRepository: { name: "nextly" },
            state: "CLOSED",
            headRefOid: chain[4],
            baseRefOid: "base000",
          },
        },
        {
          when: ["pr", "view", "1", "--repo", "nextlyhq/nextly", "state"],
          stdout: { state: "CLOSED" },
        },
      ],
    });
    expect(run.report?.verdict).toBe("CLOSED WITHOUT MERGING");
    expect(run.status).toBe(10);
    // The review evidence was never requested on this path, so it is serialized
    // as unavailable rather than as an empty result a caller could read as
    // "nothing outstanding".
    expect(run.report?.unresolved_threads).toBe("unavailable");
    expect(run.report?.missing_reviews).toBe("unavailable");
  });

  it("runs when invoked through a symlink that the runtime does not resolve", () => {
    // `--preserve-symlinks-main` leaves the link in `import.meta.url` while
    // `realpathSync` resolves it away, so an entry check comparing only the
    // resolved form matches nothing and the process exits 0 having executed
    // no code at all. Asserting a verdict rather than a status alone, because
    // "exited 0 having done nothing" and "passed" are the same status.
    const link = join(root, "linked-ci-verdict.mjs");
    rmSync(link, { force: true });
    symlinkSync(ENTRY, link);
    const run = runCli({
      cwd: shallowClone("symlink"),
      entry: link,
      nodeOptions: "--preserve-symlinks-main",
      routes: baseRoutes({
        state: "OPEN",
        headRefOid: chain[4],
        reviews: [review(CODEX, chain[4])],
        commits: [chain[4]],
      }),
    });
    expect(run.report?.verdict).toBe("CLEAN");
    expect(run.status).toBe(0);
  });

  it("refuses to answer when a request fails", () => {
    // A failed request must not reach the decision half as empty evidence:
    // "nobody has reviewed this" and "the reviews could not be read" produce
    // the same empty array, and only one of them is a verdict.
    const routes = baseRoutes({
      state: "OPEN",
      headRefOid: chain[4],
      reviews: [review(CODEX, chain[4])],
      commits: [chain[4]],
    }).map(route =>
      route.when.includes("repos/nextlyhq/nextly/pulls/1/reviews")
        ? {
            ...route,
            stdout: undefined,
            stderr: "gh: server error\n",
            exitCode: 1,
          }
        : route
    );
    const run = runCli({ cwd: shallowClone("failing"), routes });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
  });

  it("counts an unresolved thread that only appears on a later page", () => {
    // The command asks for 100 at a time. A repository with more than that
    // returns a full first page of resolved threads, and reading it alone
    // reports a clean verdict over an open one.
    const tip = chain[4];
    const routes = baseRoutes({
      state: "OPEN",
      headRefOid: tip,
      reviews: [review(CODEX, tip)],
      commits: [tip],
    }).filter(route => !route.when.includes("graphql"));
    routes.push(
      {
        // Discriminated by the ABSENCE of the cursor rather than by repeating
        // the query text, which would break this case on any edit to the query
        // and report it as an unmatched request.
        when: ["graphql"],
        unless: ["cursor=PAGE2"],
        stdout: {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: true,
                      comments: { nodes: [{ author: { login: CODEX } }] },
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: "PAGE2" },
                },
              },
            },
          },
        },
      },
      {
        when: ["graphql", "cursor=PAGE2"],
        stdout: {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      isResolved: false,
                      comments: { nodes: [{ author: { login: CODEX } }] },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        },
      }
    );
    const run = runCli({ cwd: shallowClone("paged"), routes });
    expect(run.report?.verdict).toBe("UNRESOLVED THREADS");
    expect(run.report?.unresolved_threads).toBe(1);
    expect(run.status).toBe(10);
  });

  it("rejects a pull request argument that would rewrite the request path", () => {
    // Asserted on the USAGE message rather than on the status. Exit 2 is also
    // what every later failure produces, so a weakened validation that let the
    // value through would reach `gh` and still exit 2 with empty stdout — the
    // case would stay green with the request-path protection gone. The usage
    // line is emitted only by the argument check.
    const run = runCli({
      cwd: root,
      args: ["1/../2"],
      routes: [{ when: ["auth", "setup-git"] }],
    });
    expect(run.stderr).toMatch(/^usage: /);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
  });
});
