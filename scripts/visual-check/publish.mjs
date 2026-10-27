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
  return `pr-screenshots/${topic}`;
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

/**
 * Commits `files` as the whole tree of `pr-screenshots/<topic>` and pushes it
 * to `remote`.
 *
 * The first publish of a topic is a commit with no parent; a later one sits on
 * the branch's tip, so the push is an ordinary fast-forward and needs no force.
 * Either way nothing of `main` is in its history. A capture over the size limit
 * refuses the whole publish before anything is written.
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
  const ref = `refs/heads/${branchFor(topic)}`;
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
    const tree = git(cwd, ["write-tree"], index);
    const parent = remoteTip(cwd, remote, ref);
    const message = `Screenshots for ${topic}`;
    const commit = git(cwd, [
      "commit-tree",
      tree,
      ...(parent ? ["-p", parent] : []),
      "-m",
      message,
    ]);
    git(cwd, ["push", "--quiet", remote, `${commit}:${ref}`]);
    return {
      branch: branchFor(topic),
      commit,
      rawBase: rawBaseFor(git(cwd, ["remote", "get-url", remote])),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
