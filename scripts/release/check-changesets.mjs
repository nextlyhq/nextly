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
//
// The GROUP is checked too, and against the workspace rather than against
// itself. A checker that reads `.changeset/config.json` as the source of truth
// cannot see a package added under `packages/` and never added to `fixed`, which
// is the drift that makes every changeset written afterwards wrong while each of
// them passes.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getWorkspacePackageNames } from "./lib.mjs";

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
 * What is wrong with the GROUP itself, as a list of sentences, empty when nothing is.
 *
 * The config is what every changeset is generated from, so a checker that treats
 * it as the source of truth cannot see the one drift that matters most: a pull
 * request adding a package under `packages/` and not adding it to `fixed`. Every
 * changeset in that PR names the old members, passes, and the new package is left
 * behind on the next train — discovered after a version PR has already merged.
 *
 * Compared against `packages/` rather than against the publishable subset,
 * because Changesets versions private workspace packages too unless told
 * otherwise, and four of this group's members are `private: true` build-time
 * config packages. Measuring against "what we publish" would report those four as
 * errors on every run.
 *
 * Checked in BOTH directions. A name in the group that no package answers to is
 * a rename or a deletion that the config still believes in, and Changesets fails
 * a release on an unknown package in `fixed`.
 */
export function groupMatchesWorkspace(packages, workspaceNames) {
  const problems = [];
  const absent = workspaceNames.filter(name => !packages.includes(name));
  if (absent.length > 0) {
    problems.push(
      `.changeset/config.json: the \`fixed\` group is missing ${absent.join(", ")}. ` +
        `Every package under packages/ versions with the group; one left out is ` +
        `stranded at an older version by the next release.`
    );
  }
  const unknown = packages.filter(name => !workspaceNames.includes(name));
  if (unknown.length > 0) {
    problems.push(
      `.changeset/config.json: the \`fixed\` group names ${unknown.join(", ")}, ` +
        `which no package under packages/ answers to. Changesets refuses a release ` +
        `on an unknown package in \`fixed\`.`
    );
  }
  return problems;
}

/**
 * One scalar as YAML would read it: quotes stripped, a trailing comment removed.
 *
 * A quoted value keeps everything inside the quotes, `#` included, because a
 * comment cannot start inside a scalar. Only an unquoted value has a comment to
 * strip, and only when the `#` is preceded by whitespace — `patch#1` is one
 * token, `patch # note` is a value and a note.
 */
function scalar(raw) {
  const trimmed = raw.trim();
  const quoted = /^(["'])((?:(?!\1)[\s\S])*)\1\s*(?:#[\s\S]*)?$/.exec(trimmed);
  if (quoted !== null) return quoted[2];
  return trimmed.split(/\s+#/)[0].trim();
}

/**
 * The name and the rest of one `name: bump` line, or `undefined` when it is
 * neither that nor something to skip.
 */
function entryOn(line) {
  const quotedName = /^(["'])((?:(?!\1)[\s\S])*)\1\s*:([\s\S]*)$/.exec(line);
  if (quotedName !== null) return { name: quotedName[2], rest: quotedName[3] };
  const bareName = /^([^:\s'"]+)\s*:([\s\S]*)$/.exec(line);
  if (bareName !== null) return { name: bareName[1], rest: bareName[2] };
  return undefined;
}

/**
 * The `package: bump` pairs a changeset declares, or `undefined` when the file
 * is not one this can read.
 *
 * Hand-parsed rather than handed to `@changesets/parse`, which this repository
 * does not depend on and which would be a new dependency for a lint step. The
 * subset accepted is deliberately the one Changesets itself writes and reads:
 * quoted names (single or double, which every scoped package needs), bare names,
 * quoted or bare bumps, blank lines and comments.
 *
 * The two ways a hand-rolled reader goes wrong are both closed explicitly,
 * because each fails in a direction that matters:
 *
 * - Being STRICTER than Changesets blocks a compliant pull request over a
 *   spelling the release tooling would have accepted. That is why single quotes,
 *   quoted bumps and comments are read rather than refused.
 * - Being LOOSER lets malformed release metadata reach `main`, where it fails
 *   the CI-only release workflow after a version PR has already merged. That is
 *   why the closing delimiter must be exactly `---` on its own line, and why a
 *   duplicate key is refused rather than silently taking the last one.
 *
 * A file this cannot read is reported as unreadable rather than as declaring
 * nothing: "no releases" and "every release" are opposite answers, and a
 * missing-package check would score them the same way.
 */
export function declaredReleases(fileText) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    fileText
  );
  if (match === null) return undefined;
  const releases = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const entry = entryOn(trimmed);
    if (entry === undefined) return undefined;
    const name = entry.name.trim();
    const bump = scalar(entry.rest);
    if (name === "" || bump === "") return undefined;
    // A repeated key is not a reading this can choose between. YAML's own answer
    // is to take the last, which would let `"nextly": patch` sit above
    // `"nextly": major` and report the file as compliant.
    if (releases.has(name)) return undefined;
    releases.set(name, bump);
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

/**
 * Every problem: the group's own integrity first, then each changeset against it.
 *
 * The group is checked even when the pull request touches no changeset at all,
 * because the PR that adds a package is often exactly that one — and a stale
 * group makes every later changeset wrong while each of them passes.
 */
export function checkChangesets(paths, readFile, configText, workspaceNames) {
  const packages = lockstepPackages(configText);
  if (packages.length === 0) {
    // A config with no fixed group would make every check below vacuous, and a
    // guard that passes because it found nothing to check is worse than none.
    return [
      ".changeset/config.json declares no `fixed` group, so nothing here can be checked.",
    ];
  }
  return [
    ...groupMatchesWorkspace(packages, workspaceNames),
    ...paths.flatMap(path => problemsWith(path, readFile(path), packages)),
  ];
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
  // No early return on an empty list. The group's own integrity still has to be
  // checked, and the pull request that adds a package is often the one that
  // touches no changeset at all.
  const problems = checkChangesets(
    paths,
    path => readFileSync(resolve(REPO_ROOT, path), "utf8"),
    readFileSync(resolve(REPO_ROOT, ".changeset", "config.json"), "utf8"),
    getWorkspacePackageNames()
  );
  if (problems.length === 0) {
    console.log(
      paths.length === 0
        ? "No changesets added or edited; the lockstep group matches the workspace."
        : `Checked ${paths.length} changeset(s): all cover the group.`
    );
    return 0;
  }
  for (const problem of problems) console.error(`✖ ${problem}`);
  return 1;
}

// Only when run directly, so the exported helpers stay importable from a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
