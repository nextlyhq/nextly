// Refuses a changeset that does not cover every package in the lockstep group.
//
// The packages version together, so a release advances all of them whatever a
// single changeset lists. What an incomplete one loses is the CHANGELOG: a
// package left out of the frontmatter gets a version bump with no entry
// explaining it, and the note that should have appeared under it is filed only
// under the packages that were named. The release is still correct; the record
// of it is not.
//
// This existed as a review convention and was caught by a reviewer twice in one
// afternoon, both times on a changeset that HAD been generated from the config —
// once written before a new package joined the group, once written before the
// branch merged the commit that added it. A convention that depends on
// regenerating at the right moment is one a build should check instead.
//
// Scoped to the changesets a branch ADDS or EDITS, never the backlog. Several
// hundred are pending on `main`, most written before the group grew, and
// rewriting them to satisfy a rule they predate would put churn in front of
// every reader of the eventual changelog for no gain.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The bump every changeset uses while the packages are in alpha.
 *
 * A `minor` or `major` here does not just mislabel one entry: the group versions
 * in lockstep, so the largest bump in the release decides the number every
 * package gets, and one mislabelled changeset moves the whole train.
 */
const ALPHA_BUMP = "patch";

/** Every package that must appear in a changeset, read from the Changesets config. */
export function lockstepPackages(configText) {
  const config = JSON.parse(configText);
  return (config.fixed ?? []).flat();
}

/**
 * The `package: bump` pairs a changeset declares.
 *
 * Parsed rather than pulled from `@changesets/parse`, because the answer needed
 * here is "what does the file SAY", and a parser that tolerates a malformed
 * frontmatter by returning an empty release list would report a changeset naming
 * nothing as one naming nothing WRONG. A file this cannot read is reported as
 * unreadable instead.
 */
export function declaredReleases(fileText) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fileText);
  if (match === null) return undefined;
  const releases = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // Both spellings Changesets accepts for a name: quoted, which every scoped
    // package needs, and bare, which an unscoped one may use.
    const entry = /^(?:"([^"]+)"|([^:\s]+))\s*:\s*(\S+)\s*$/.exec(trimmed);
    if (entry === null) return undefined;
    releases.set(entry[1] ?? entry[2], entry[3]);
  }
  return releases;
}

/**
 * What is wrong with one changeset, as a list of sentences, empty when nothing is.
 *
 * Returns every problem rather than the first, so one push answers all of them.
 * A guard that reports one missing package at a time turns a stale frontmatter
 * into as many CI rounds as it has gaps.
 */
export function problemsWith(path, fileText, packages) {
  const releases = declaredReleases(fileText);
  if (releases === undefined) {
    return [
      `${path}: the frontmatter is missing or has a line this cannot read. ` +
        `A changeset opens with \`---\`, one \`"package": bump\` per line, and closes with \`---\`.`,
    ];
  }
  const problems = [];
  const missing = packages.filter(name => !releases.has(name));
  if (missing.length > 0) {
    problems.push(
      `${path}: missing ${missing.length} of ${packages.length} lockstep packages — ` +
        `${missing.join(", ")}. They version together, so a package left out is bumped ` +
        `with no changelog entry. Generate the list from .changeset/config.json.`
    );
  }
  const unknown = [...releases.keys()].filter(name => !packages.includes(name));
  if (unknown.length > 0) {
    problems.push(
      `${path}: names ${unknown.join(", ")}, which the lockstep group does not contain. ` +
        `A package that has left the group, or a typo, releases nothing.`
    );
  }
  const wrongBump = [...releases.entries()]
    .filter(([, bump]) => bump !== ALPHA_BUMP)
    .map(([name, bump]) => `${name}: ${bump}`);
  if (wrongBump.length > 0) {
    problems.push(
      `${path}: uses a bump other than \`${ALPHA_BUMP}\` (${wrongBump.join(", ")}). ` +
        `The group takes the largest bump in the release, so one of these moves every package.`
    );
  }
  return problems;
}

/** Every problem across the given changeset paths. */
export function checkChangesets(paths, readFile, configText) {
  const packages = lockstepPackages(configText);
  if (packages.length === 0) {
    // A config with no fixed group would make every check below vacuous, and a
    // guard that passes because it found nothing to check is worse than none.
    return [
      ".changeset/config.json declares no `fixed` group, so nothing here can be checked.",
    ];
  }
  return paths.flatMap(path => problemsWith(path, readFile(path), packages));
}

/**
 * The changeset files to check: arguments when given, otherwise a newline-separated
 * list on stdin.
 *
 * Passed in rather than discovered, because "which changesets does this branch
 * add" is a question about git that the caller already has to ask, and asking it
 * here would mean this script could only run one way.
 *
 * Stdin is what the workflow uses, and it is the reason the empty case is not a
 * special one: a pipe that produced nothing arrives as an empty string, whereas
 * an empty argument list has to survive shell expansion under `set -u` to get
 * here at all.
 */
export function pathsToCheck(argv, stdinText) {
  const fromArgv = argv.filter(path => path.endsWith(".md"));
  if (fromArgv.length > 0) return fromArgv;
  return stdinText
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.endsWith(".md"));
}

/**
 * Everything piped in, as text.
 *
 * Streamed rather than read with `readFileSync(0)`. A pipe can be open and
 * momentarily empty, and the synchronous read answers that with `EAGAIN` instead
 * of waiting — which fails whenever the process on the other side is a shade
 * slower than this one, and passes when it is not. A guard that depends on
 * scheduling is worse than no guard.
 *
 * A terminal is not read at all: a hand-run with no arguments would otherwise
 * wait forever for input nobody is going to type.
 */
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv) {
  const paths = pathsToCheck(argv, await readStdin());
  if (paths.length === 0) {
    console.log("No changesets added or edited; nothing to check.");
    return 0;
  }
  const problems = checkChangesets(
    paths,
    path => readFileSync(resolve(REPO_ROOT, path), "utf8"),
    readFileSync(resolve(REPO_ROOT, ".changeset", "config.json"), "utf8")
  );
  if (problems.length === 0) {
    console.log(`Checked ${paths.length} changeset(s): all cover the group.`);
    return 0;
  }
  for (const problem of problems) console.error(`✖ ${problem}`);
  return 1;
}

// Only when run directly, so the exported helpers stay importable from a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
