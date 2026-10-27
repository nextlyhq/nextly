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

/** Where a capture is linked from when the remote is not on GitHub: nextly's own repository. */
const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com/nextlyhq/nextly";

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
 * The raw-content address of the repository a remote URL names, so a fork's
 * captures link to the fork. Anything not on GitHub links to nextly's own.
 */
export function rawBaseFor(remoteUrl) {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    remoteUrl.trim()
  );
  return match
    ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}`
    : DEFAULT_RAW_BASE;
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
export function lookSection({ rawBase, topic, files }) {
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
 * The branch checked out in `cwd`, which a publish records as its source. A
 * detached HEAD names none, so it is refused rather than recorded as nothing.
 */
function currentBranch(cwd) {
  try {
    return git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    throw new Error(
      "Not published: HEAD is detached, so there is no branch to record as the source. Check out the change's branch first."
    );
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
 * Refuses to publish over a topic another branch owns.
 *
 * Topics are short and readable, so two changes can pick the same one, and a
 * publish over another change's captures would replace the images its pull
 * request shows without a word. A branch that records no source (one made by
 * hand) could belong to anyone, so it is refused too.
 */
function checkOwner(cwd, topic, tip, source) {
  const owner = sourceBranchOf(cwd, tip);
  if (!owner) {
    throw new Error(
      `Not published: ${branchFor(topic)} exists and records no source branch, so it may hold another change's captures. Choose another topic.`
    );
  }
  if (owner !== source) {
    throw new Error(
      `Not published: ${branchFor(topic)} was published from ${owner}, not ${source}. Choose another topic.`
    );
  }
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
 * the publish (a capture over the size limit, a detached HEAD, a topic another
 * branch owns) is checked before anything is written.
 */
export async function publishCaptures({
  cwd,
  topic,
  files,
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
  const source = currentBranch(cwd);
  const ref = `refs/heads/${branchFor(topic)}`;
  const parent = remoteTip(cwd, remote, ref);
  if (parent) checkOwner(cwd, topic, parent, source);
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
    rawBase: rawBaseFor(git(cwd, ["remote", "get-url", remote])),
  };
}

/**
 * Deletes `pr-screenshots/<topic>` from `remote`, once a pull request that
 * showed it is merged or closed, and says which branch had published it.
 *
 * The delete is leased on the tip just read, so a publish that lands in
 * between is not deleted unseen. A topic never published deletes nothing.
 */
export async function unpublishCaptures({ cwd, topic, remote = "origin" }) {
  const ref = `refs/heads/${branchFor(topic)}`;
  const tip = remoteTip(cwd, remote, ref);
  if (!tip) return { deleted: false };
  const source = sourceBranchOf(cwd, tip) || undefined;
  git(cwd, [
    "push",
    "--quiet",
    `--force-with-lease=${ref}:${tip}`,
    remote,
    `:${ref}`,
  ]);
  return { deleted: true, source };
}
