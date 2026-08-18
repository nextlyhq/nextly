/**
 * The dev doctor's build-artifacts check, and the limit of what it can say.
 *
 * The check existed untested while `dev:app` gated its build on it, and the
 * gate could not see the case that kept breaking: a `dist` missing in a package
 * OTHER than the sentinel's. These cases pin what it does answer and, more
 * usefully, assert the blind spot rather than leaving it to be rediscovered —
 * because a check whose limits are undocumented reads as one with none.
 *
 * @module dev-doctor.test
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkBuildArtifacts } from "./dev-doctor.mjs";

const made = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A throwaway workspace root, with whichever package dists are named. */
async function workspace(dists = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "nextly-doctor-"));
  made.push(root);
  for (const [pkg, files] of Object.entries(dists)) {
    const dir = path.join(root, "packages", pkg, "dist");
    await mkdir(dir, { recursive: true });
    for (const file of files) await writeFile(path.join(dir, file), "x");
  }
  return root;
}

describe("checkBuildArtifacts", () => {
  it("reports a workspace nobody has built", async () => {
    const root = await workspace();

    const result = await checkBuildArtifacts(root);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });

  it("reports an EMPTY dist as unbuilt", async () => {
    // Distinct from absent: a `rimraf dist` that ran without the build that
    // follows it leaves the directory there and empty.
    const root = await workspace({ nextly: [] });

    expect((await checkBuildArtifacts(root)).ok).toBe(false);
  });

  it("passes once the sentinel package has output", async () => {
    // The control. Without it every assertion above would be satisfied by a
    // check that reported failure unconditionally.
    const root = await workspace({ nextly: ["index.mjs"] });

    expect((await checkBuildArtifacts(root)).ok).toBe(true);
  });

  it("CANNOT see a dist missing from another package", async () => {
    /*
     * The blind spot, asserted as a DELTA rather than as a state.
     *
     * Checking `ok === true` on a workspace with no builder output would be the
     * same assertion as the control above and would demonstrate nothing. What
     * shows the insensitivity is that removing the output changes NOTHING about
     * the answer: the check reports ok before and after, while the thing that
     * renders the admin blank has appeared in between.
     *
     * `packages/builder/dist` absent is that thing — the page builder's
     * stylesheet `@import`s a file from it — and this is why `dev:app` no
     * longer gates its build on this result.
     */
    const root = await workspace({
      nextly: ["index.mjs"],
      builder: ["builder-chrome.css"],
    });
    const withOutput = await checkBuildArtifacts(root);

    await rm(path.join(root, "packages", "builder", "dist"), {
      recursive: true,
      force: true,
    });
    const withoutOutput = await checkBuildArtifacts(root);

    expect(withOutput.ok).toBe(true);
    // The answer did not move, which is the finding.
    expect(withoutOutput.ok).toBe(true);
  });
});
