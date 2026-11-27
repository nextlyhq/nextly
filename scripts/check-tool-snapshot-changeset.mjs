#!/usr/bin/env node

/**
 * Whether a change to an MCP door's tool-list snapshot comes with a
 * changeset. A snapshot holds every tool name, title, description, hint and
 * schema an agent sees, so changing one changes the package's public surface,
 * and the release that ships it must say so in its changelog.
 *
 * A change touches a snapshot when it adds, edits, renames or removes a file
 * under `packages/mcp/src/__snapshots__/`. It is covered when the same change
 * adds or edits a changeset (`.changeset/*.md`, not its README) whose
 * frontmatter lists `@nextlyhq/mcp`.
 *
 * In CI it reads the branch's commits against its base branch, or the commits
 * the merge queue would land, from the checkout it is run in, and imports nothing
 * but Node's own modules, so the change it judges can't alter it.
 *
 * Usage: node scripts/check-tool-snapshot-changeset.mjs [<base> <head>]
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Where the doors' tool-list snapshots live. */
export const SNAPSHOT_DIR = "packages/mcp/src/__snapshots__/";

/** The package a covering changeset must name. */
export const PACKAGE = "@nextlyhq/mcp";

/** Whether `path` is a changeset file, not the folder's README. */
function isChangeset(path) {
  return /^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md";
}

/** The package names a changeset's frontmatter lists. */
export function changesetPackages(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/^\s*["']?([^"':\s]+)["']?\s*:/gm)].map(entry => entry[1]);
}

/**
 * The problem with `changes`, or `undefined` when there is none. `changes`
 * lists each changed file as `{ status, paths }` (a rename has two paths);
 * `readAtHead` gives a file's text as the change leaves it.
 */
export function snapshotChangesetProblem(changes, readAtHead) {
  const snapshots = changes
    .flatMap(change => change.paths)
    .filter(path => path.startsWith(SNAPSHOT_DIR));
  if (snapshots.length === 0) return undefined;
  const covering = changes
    .filter(change => change.status !== "D")
    .flatMap(change => change.paths.slice(-1))
    .filter(isChangeset)
    .filter(path => changesetPackages(readAtHead(path)).includes(PACKAGE));
  if (covering.length > 0) return undefined;
  return (
    `The tool list agents see changed (${[...new Set(snapshots)].join(", ")}), ` +
    `but no changeset in this change lists "${PACKAGE}". Add one that says what changed for agents: ` +
    "a tool's name, inputs, answer or hints."
  );
}

/** The changed files between `base` and `head`, as git reports them. */
export function changedFiles(base, head, cwd = process.cwd()) {
  const out = execFileSync("git", ["diff", "--name-status", "-M", `${base}...${head}`], {
    cwd,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [status, ...paths] = line.split("\t");
      return { status: status.charAt(0), paths };
    });
}

/** The range this run judges, from its arguments or from the CI event. */
function range(argv, env) {
  if (argv.length === 2) return { base: argv[0], head: argv[1] };
  if (env.EVENT === "pull_request_target" && env.BASE_REF) {
    return { base: `origin/${env.BASE_REF}`, head: "HEAD" };
  }
  if (env.EVENT === "merge_group" && env.QUEUE_BASE && env.QUEUE_HEAD) {
    return { base: env.QUEUE_BASE, head: env.QUEUE_HEAD };
  }
  return undefined;
}

function main() {
  const judged = range(process.argv.slice(2), process.env);
  if (!judged) {
    console.log(
      "::error title=Tool-list snapshot::no range to judge; pass <base> <head>, or run it on a pull_request_target or merge_group event"
    );
    process.exit(1);
  }
  const changes = changedFiles(judged.base, judged.head);
  const problem = snapshotChangesetProblem(changes, path =>
    // `cat-file` gives the stored bytes, with no text conversion or filter a
    // change's attributes could name.
    execFileSync("git", ["cat-file", "-p", `${judged.head}:${path}`], { encoding: "utf8" })
  );
  if (problem) {
    console.log(`::error title=Tool-list snapshot::${problem}`);
    process.exit(1);
  }
  console.log(`tool-list snapshots: ${changes.length} changed file(s) read, nothing to report`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
