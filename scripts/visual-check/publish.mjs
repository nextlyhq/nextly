/**
 * Publishing a run's captures for a pull request: a commit of the images alone
 * on `pr-screenshots/<topic>`, a branch that shares no history with `main`,
 * pushed to `origin`; and the "The look" section that shows them in a pull
 * request's body.
 *
 * The commit is built from a temporary index with git's plumbing, so the
 * author's checkout, index and branches are never touched, and no local
 * branch is left behind: only the remote ref is written.
 *
 * @module scripts/visual-check/publish
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SCREENSHOT_BRANCHES } from "./options.mjs";

/**
 * The largest capture published. GitHub draws an image in a pull request body
 * through its camo proxy, and a large one there loads slowly or not at all on
 * a phone, which is where a pull request is often read.
 */
export const MAX_CAPTURE_BYTES = 1024 * 1024;

/** The branch a topic's captures are published to. */
function branchFor(topic) {
  return `${SCREENSHOT_BRANCHES}${topic}`;
}

/** Each capture over the limit, with its size. */
export function oversizedCaptures(files) {
  return files
    .map(file => ({ file, bytes: statSync(file).size }))
    .filter(({ bytes }) => bytes > MAX_CAPTURE_BYTES);
}

/**
 * The forms a GitHub remote URL takes: a URL (https, ssh, git) whose host is
 * github.com, and git's scp-like `git@github.com:owner/repo`. The host must
 * be github.com exactly; an ssh alias or another host is not matched.
 */
const GITHUB_REMOTES = [
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^(?:[^@/:]+@)?github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

/**
 * The raw-content address of the GitHub repository a remote URL names, so a
 * fork's captures link to the fork, or null for a remote it cannot map to
 * GitHub. Null rather than a guess: a link to the wrong repository shows a
 * reviewer nothing, or another branch's images.
 */
export function rawBaseFor(remoteUrl) {
  for (const form of GITHUB_REMOTES) {
    const match = form.exec(remoteUrl.trim());
    if (match)
      return `https://raw.githubusercontent.com/${match[1]}/${match[2]}`;
  }
  return null;
}

/** A capture name's parts: the route's slug, the width and the scheme. */
function partsOf(file) {
  const match = /^(.*)-(\d+)-(light|dark)\.png$/.exec(file);
  return match
    ? { screen: match[1], width: Number(match[2]), scheme: match[3] }
    : { screen: file, width: 0, scheme: "light" };
}

/**
 * A pull request's "The look" section: a table per width, narrowest first
 * since a pull request is often read on a phone, with a row per screen and light
 * and dark side by side, each image linked by its raw address.
 */
export function lookSection({ rawBase, topic, files, findings = [] }) {
  const url = file =>
    `${rawBase}/${branchFor(topic)}/${encodeURIComponent(file)}`;
  const byWidth = new Map();
  for (const file of files) {
    const { screen, width, scheme } = partsOf(file);
    if (!byWidth.has(width)) byWidth.set(width, new Map());
    const screens = byWidth.get(width);
    if (!screens.has(screen)) screens.set(screen, {});
    screens.get(screen)[scheme] = file;
  }
  const lines = [
    "## The look",
    "",
    "Captured by `pnpm visual-check` from a production build, signed in, with seeded content.",
  ];
  for (const width of [...byWidth.keys()].sort((a, b) => a - b)) {
    lines.push(
      "",
      `### ${width} px`,
      "",
      "| Screen | Light | Dark |",
      "| --- | --- | --- |"
    );
    for (const [screen, schemes] of byWidth.get(width)) {
      const cell = scheme =>
        schemes[scheme]
          ? `![${screen}, ${width} px, ${scheme}](${url(schemes[scheme])})`
          : "";
      lines.push(`| \`${screen}\` | ${cell("light")} | ${cell("dark")} |`);
    }
  }
  // Findings published by choice are listed under the captures, so the reader
  // judges the screens knowing what the checks found on them.
  if (findings.length > 0) {
    lines.push(
      "",
      "### Findings",
      "",
      "Published with `--allow-findings`: the checks found these, and they predate the change.",
      "",
      ...findings.map(finding => `- ${finding}`)
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Runs git in `cwd`, returning its trimmed output and failing with what git said. */
function git(cwd, args, env = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const said =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(`git ${args[0]} failed${said ? `: ${said}` : ""}`);
  }
}

/**
 * The branch's current tip on the remote, fetched so a new commit can sit on
 * top of it, or undefined when the branch does not exist yet. Fetched without
 * writing FETCH_HEAD, which every worktree of a clone shares.
 */
function remoteTip(cwd, remote, ref) {
  const listed = git(cwd, ["ls-remote", remote, ref]);
  const tip = listed.split(/\s+/)[0];
  if (!tip) return undefined;
  git(cwd, ["fetch", "--quiet", "--no-write-fetch-head", remote, ref]);
  git(cwd, ["cat-file", "-e", `${tip}^{commit}`]);
  return tip;
}

/** The trailer a publish records its source branch in. */
const SOURCE_TRAILER = "Source-Branch";

/**
 * The branch checked out in `cwd`, or null on a detached HEAD, which names
 * none: a publish records it as its source, and an unpublish claims it.
 */
function currentBranch(cwd) {
  try {
    return git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    return null;
  }
}

/** The source branch a published commit records, or "" when it records none. */
function sourceBranchOf(cwd, commit) {
  return git(cwd, [
    "log",
    "-1",
    `--format=%(trailers:key=${SOURCE_TRAILER},valueonly)`,
    commit,
  ]);
}

/**
 * Why `claimed` may not act on a topic whose tip is `tip`, or null when it
 * may: the topic records no source branch, or another one.
 *
 * Topics are short and readable, so two changes can pick the same one, and a
 * publish over, or a delete of, another change's captures would change the
 * images its pull request shows without a word. A branch that records no
 * source (one made by hand) could belong to anyone, so it is refused too.
 */
function ownerProblem(cwd, topic, tip, claimed) {
  const owner = sourceBranchOf(cwd, tip);
  if (!owner) {
    return {
      owner,
      problem: `${branchFor(topic)} records no source branch, so it may hold another change's captures`,
    };
  }
  if (owner !== claimed) {
    return {
      owner,
      problem: `${branchFor(topic)} was published from ${owner}, not ${claimed}`,
    };
  }
  return null;
}

/** Builds a tree of `files`, by their base names, in a temporary index. */
function treeOf(cwd, files) {
  const scratch = mkdtempSync(path.join(tmpdir(), "visual-check-index-"));
  try {
    const index = { GIT_INDEX_FILE: path.join(scratch, "index") };
    for (const file of files) {
      const blob = git(cwd, ["hash-object", "-w", file]);
      git(
        cwd,
        [
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blob},${path.basename(file)}`,
        ],
        index
      );
    }
    return git(cwd, ["write-tree"], index);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Commits `files` as the whole tree of `pr-screenshots/<topic>` and pushes it
 * to `remote`, recording the branch checked out in `cwd` as its source.
 *
 * The first publish of a topic is a commit with no parent; a later one sits on
 * the branch's tip, so the push is an ordinary fast-forward and needs no force.
 * Either way nothing of `main` is in its history. Everything that can refuse
 * the publish (a capture over the size limit, a remote with no raw address it
 * can read and no `rawBase` given, a detached HEAD, a topic another branch
 * owns) is checked before anything is written.
 */
export async function publishCaptures({
  cwd,
  topic,
  files,
  rawBase,
  remote = "origin",
}) {
  const oversized = oversizedCaptures(files);
  if (oversized.length > 0) {
    const named = oversized.map(
      ({ file, bytes }) =>
        `${path.basename(file)} (${(bytes / 1024 / 1024).toFixed(2)} MB)`
    );
    throw new Error(
      `Not published: over the ${MAX_CAPTURE_BYTES / 1024 / 1024} MB limit: ${named.join(", ")}`
    );
  }
  // Where the section links the captures, settled before anything is
  // written: `--raw-base` when given, else origin's GitHub repository.
  const remoteUrl = git(cwd, ["remote", "get-url", remote]);
  const linkedUnder = rawBase ?? rawBaseFor(remoteUrl);
  if (!linkedUnder) {
    throw new Error(
      `Not published: ${remote} is ${remoteUrl}, which is not a GitHub URL its raw address can be read from. Pass --raw-base https://raw.githubusercontent.com/<owner>/<repo> for the repository it pushes to.`
    );
  }
  const source = currentBranch(cwd);
  if (!source) {
    throw new Error(
      "Not published: HEAD is detached, so there is no branch to record as the source. Check out the change's branch first."
    );
  }
  const ref = `refs/heads/${branchFor(topic)}`;
  const parent = remoteTip(cwd, remote, ref);
  const refused = parent && ownerProblem(cwd, topic, parent, source);
  if (refused) {
    throw new Error(`Not published: ${refused.problem}. Choose another topic.`);
  }
  const commit = git(cwd, [
    "commit-tree",
    treeOf(cwd, files),
    ...(parent ? ["-p", parent] : []),
    "-m",
    `Screenshots for ${topic}`,
    "-m",
    `${SOURCE_TRAILER}: ${source}`,
  ]);
  git(cwd, ["push", "--quiet", remote, `${commit}:${ref}`]);
  return {
    branch: branchFor(topic),
    commit,
    rawBase: linkedUnder,
  };
}

/**
 * Deletes `pr-screenshots/<topic>` from `remote`, once a pull request that
 * showed it is merged or closed, and says which branch had published it.
 *
 * Only the branch that published it may: the one checked out, or `owner`,
 * named explicitly for the usual case of deleting from `main` after a merge.
 * Naming it proves the intent and catches a typo, since it must match the
 * branch the topic records.
 *
 * The delete is leased on the tip just read, so a publish that lands in
 * between is not deleted unseen. A topic never published deletes nothing.
 */
export async function unpublishCaptures({
  cwd,
  topic,
  owner,
  remote = "origin",
}) {
  const ref = `refs/heads/${branchFor(topic)}`;
  const tip = remoteTip(cwd, remote, ref);
  if (!tip) return { deleted: false };
  const claimed = owner ?? currentBranch(cwd) ?? "a detached HEAD";
  const refused = ownerProblem(cwd, topic, tip, claimed);
  if (refused) {
    const how = refused.owner
      ? `Run it from ${refused.owner}, or pass --owner ${refused.owner}.`
      : "Delete it by hand if it is yours.";
    throw new Error(`Not deleted: ${refused.problem}. ${how}`);
  }
  const source = sourceBranchOf(cwd, tip);
  git(cwd, [
    "push",
    "--quiet",
    `--force-with-lease=${ref}:${tip}`,
    remote,
    `:${ref}`,
  ]);
  return { deleted: true, source };
}
