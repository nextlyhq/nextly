/**
 * The Node versions the server-safe RSC job runs against, derived from the supported range.
 *
 * The range and the matrix answer one question and cannot be one value — a matrix needs exact
 * versions and `engines.node` is a semver expression — so the matrix is COMPUTED from the range
 * rather than written beside it. A list written by hand drifts the first time the range moves, and
 * the drift is silent: every leg passes, on the versions someone remembered.
 *
 * Two kinds of clause, and they need opposite treatment:
 *
 * - A CLOSED clause (`^20.19.0`) admits one line, and the version worth testing is its FLOOR. That
 *   is where a global Node added later is absent, which is the failure this job exists to find.
 * - An OPEN clause (`>=24.0.0`) admits every line from its floor upward, including ones that do not
 *   exist yet. Testing the floor and the newest release leaves the majors BETWEEN them unexercised
 *   — with 24, 25 and 26 released, a floor of 24 plus `latest` never runs 25.
 *
 * So the open clause contributes its floor plus every released major above it. That list comes from
 * Node's own release index rather than from a constant here, because a constant is the hand-written
 * list one level down: it would need an edit every six months, and nothing would fail until the
 * major it was missing broke a consumer.
 *
 * Usage:
 *   node scripts/node-matrix.mjs            print the matrix as JSON
 *   node scripts/node-matrix.mjs --github   append `versions=<json>` to $GITHUB_OUTPUT
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_INDEX = "https://nodejs.org/dist/index.json";

/**
 * The exact versions a range asks to be tested, given the majors Node has actually released.
 *
 * @param {string} range a semver range of `^x.y.z` and `>=x.y.z` clauses joined by `||`
 * @param {readonly number[]} releasedMajors every major with at least one release
 * @returns {string[]}
 */
export function matrixFor(range, releasedMajors) {
  const versions = [];
  for (const clause of range.split("||").map(part => part.trim())) {
    const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(clause);
    const open = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(clause);
    if (caret !== null) {
      versions.push(`${caret[1]}.${caret[2]}.${caret[3]}`);
      continue;
    }
    if (open === null) {
      // Refused rather than skipped. Skipping produces a SHORTER matrix, which is a quieter
      // failure than none at all: the job keeps passing on the clauses that were understood.
      throw new Error(
        `engines.node clause ${JSON.stringify(clause)} is neither a caret nor a >= range, so the ` +
          `versions it admits could not be derived. Teach this function the new form.`
      );
    }
    const floor = Number(open[1]);
    versions.push(`${open[1]}.${open[2]}.${open[3]}`);
    // Every major ABOVE the open floor that exists. The floor's own major is already covered by the
    // exact floor version pushed above.
    for (const major of [...new Set(releasedMajors)].sort((a, b) => a - b)) {
      if (major > floor) versions.push(String(major));
    }
  }
  return versions;
}

/** The single lowest floor, which is the one leg a pull request runs. */
export function lowestFloor(range) {
  const first = matrixFor(range, [])[0];
  if (first === undefined) {
    throw new Error("engines.node named no versions, so no leg could be selected.");
  }
  return first;
}

/** Every major with at least one release, read from Node's own index. */
async function releasedMajors() {
  const response = await fetch(RELEASE_INDEX);
  if (!response.ok) {
    throw new Error(
      `${RELEASE_INDEX} answered ${response.status}, so the released majors are unknown. Failing ` +
        `rather than running a narrower matrix, which would pass while covering less.`
    );
  }
  const releases = await response.json();
  return releases.map(release => Number(release.version.slice(1).split(".")[0]));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("node-matrix.mjs");

if (invokedDirectly) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const range = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    .engines.node;
  const versions = matrixFor(range, await releasedMajors());
  const payload = JSON.stringify(versions);

  if (process.argv[2] === "--github") {
    const out = process.env.GITHUB_OUTPUT;
    if (out === undefined) {
      console.error("GITHUB_OUTPUT is not set, so the matrix could not be published.");
      process.exit(1);
    }
    appendFileSync(out, `versions=${payload}\n`);
    appendFileSync(out, `lowest=${JSON.stringify([lowestFloor(range)])}\n`);
  }
  console.log(payload);
}
