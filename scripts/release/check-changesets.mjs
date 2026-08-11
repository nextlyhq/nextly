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

import parseChangeset from "@changesets/parse";

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

/**
 * Whether `fixed` has the SHAPE Changesets requires, as a list of sentences.
 *
 * Flattening answers the same set for `[["a","b"]]` and for `["a","b"]`, so a
 * config hand-edited into the flat form produces exactly the expected names here
 * and is refused by the release tooling. Same for a package repeated across two
 * groups: flattening hides it, `@changesets/config` rejects it. Either way the
 * malformed config merges and surfaces only when a release is attempted.
 *
 * Checked here rather than by handing the file to `@changesets/config`, whose
 * `parse` needs a resolved workspace from `@manypkg/get-packages` — a second
 * dependency, for a rule that is three sentences long and fully stated by them.
 * That is the opposite trade to the YAML reader, and for the opposite reason:
 * this rule cannot drift, and a frontmatter grammar can.
 */
export function fixedGroupShape(config) {
  const groups = config.fixed;
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) {
    return ['.changeset/config.json: `fixed` must be an array of arrays.'];
  }
  const problems = [];
  const flat = groups.filter(group => !Array.isArray(group));
  if (flat.length > 0) {
    problems.push(
      '.changeset/config.json: `fixed` must be an array of ARRAYS — a group per ' +
        `line, not a flat list of names. Found ${JSON.stringify(flat[0])} where a group was expected.`
    );
    return problems;
  }
  const seen = new Set();
  const repeated = new Set();
  for (const group of groups) {
    for (const name of group) {
      if (typeof name !== "string" || name === "") {
        problems.push(
          `.changeset/config.json: \`fixed\` holds ${JSON.stringify(name)}, which is not a package name.`
        );
        continue;
      }
      if (seen.has(name)) repeated.add(name);
      seen.add(name);
    }
  }
  if (repeated.size > 0) {
    problems.push(
      `.changeset/config.json: \`fixed\` lists ${[...repeated].join(", ")} in more than one ` +
        `group. The groups must be disjoint; a package cannot version in lockstep with two sets.`
    );
  }
  return problems;
}

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
 * The `package: bump` pairs a changeset declares, or `undefined` when Changesets
 * itself would refuse the file.
 *
 * Handed to `@changesets/parse` rather than read here. A hand-rolled reader was
 * tried and corrected twice — once for being STRICTER than Changesets (single
 * quotes, quoted bumps and comments are valid YAML it was rejecting, which
 * blocks a compliant pull request) and once for being LOOSER (`---junk` as a
 * closing delimiter, and duplicate keys, which it accepted and the release
 * tooling does not). A third such correction would have been the third instance
 * of one shape, so the reading moved to the library that decides the real answer
 * instead. Anything this accepts, the release accepts, by construction rather
 * than by agreement.
 *
 * `@changesets/parse` was already in the tree as a transitive dependency of
 * `@changesets/cli`; declaring it changes what resolves, not what is installed.
 *
 * A file it refuses is reported as unreadable rather than as declaring nothing:
 * "no releases" and "every release" are opposite answers, and a missing-package
 * check would score them the same way. That distinction is why the empty case is
 * still called out separately below — `parse` returns an empty release list for a
 * frontmatter that is well-formed and says nothing.
 */
export function declaredReleases(fileText) {
  let parsed;
  try {
    parsed = parseChangeset(fileText);
  } catch {
    return undefined;
  }
  const releases = new Map();
  for (const release of parsed.releases) releases.set(release.name, release.type);
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
  if (releases.size === 0) {
    // Well-formed and saying nothing. Reported on its own rather than as "missing
    // all of them", because the cause is different — an empty frontmatter is a
    // changeset someone forgot to fill in, not one generated against an older
    // group — and the fix a reader needs is not the same.
    return [
      `${path}: declares no packages at all. A changeset that releases nothing ` +
        `still consumes a file name and produces no changelog entry.`,
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
  const shape = fixedGroupShape(JSON.parse(configText));
  // Returned alone. Every check below reads the flattened group, and a group
  // whose shape is wrong flattens to something that looks right — so reporting
  // the downstream answers beside it would be reporting answers derived from a
  // reading the release tooling does not share.
  if (shape.length > 0) return shape;
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
/**
 * Whether a path names a file Changesets would READ as a changeset.
 *
 * Copied from `@changesets/read`, whose filter is
 * `!file.startsWith(".") && file.endsWith(".md") && !/^README\.md$/i.test(file)`.
 * Anything else in `.changeset/` is documentation or a helper — a template, a
 * README in any casing — and passing one of those to a frontmatter check rejects
 * ordinary docs as malformed.
 *
 * Applied HERE rather than in the workflow's `grep`, so a hand-run and the build
 * agree about what a changeset is. A shell filter is one caller's answer.
 */
function isChangesetFile(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    !name.startsWith(".") && name.endsWith(".md") && !/^README\.md$/i.test(name)
  );
}

export function pathsToCheck(argv, stdinText) {
  const fromArgv = argv.filter(isChangesetFile);
  if (fromArgv.length > 0) return fromArgv;
  return stdinText
    .split("\n")
    .map(line => line.trim())
    .filter(isChangesetFile);
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
