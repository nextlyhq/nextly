/**
 * Every workflow and local action GitHub would load is valid YAML.
 *
 * A workflow that does not parse creates no jobs and no check-runs. Nothing
 * refuses it locally: lint-staged formats `.json`, `.css`, `.scss` and `.md`,
 * not `.yml`, and the scripts that read these files pull one block out with
 * text search rather than parsing the document. So an unquoted `: ` inside a
 * `${{ }}` expression reached a pushed branch, and the workflow it lived in
 * would have loaded as nothing on `main`.
 *
 * `js-yaml` rather than GitHub's own parser, which is not available; both are
 * YAML 1.2 readers and the failures this catches (indentation, an unquoted
 * mapping indicator, a stray tab) are not dialect questions.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every `.yml`/`.yaml` under `.github/workflows`, and every local action's manifest. */
function githubYamlFiles() {
  const workflows = join(ROOT, ".github", "workflows");
  const actions = join(ROOT, ".github", "actions");
  const files = readdirSync(workflows)
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => join(workflows, name));
  for (const dir of readdirSync(actions)) {
    const path = join(actions, dir);
    if (!statSync(path).isDirectory()) continue;
    for (const name of ["action.yml", "action.yaml"]) {
      try {
        statSync(join(path, name));
        files.push(join(path, name));
      } catch {
        // The other spelling is the one this action uses.
      }
    }
  }
  return files;
}

describe("GitHub workflow and action YAML", () => {
  const files = githubYamlFiles();

  it("finds the files it exists to check", () => {
    // The control: an empty list would make every case below vacuous.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some(f => f.endsWith("ci.yml"))).toBe(true);
    expect(files.some(f => f.endsWith("action.yml"))).toBe(true);
  });

  for (const file of files) {
    it(`parses ${file.slice(ROOT.length)}`, () => {
      const doc = load(readFileSync(file, "utf8"));
      expect(doc, "a document, not a scalar").toBeTypeOf("object");
      // A workflow declares jobs; an action declares how it runs. Either way
      // a document that parsed to something else is one GitHub would refuse.
      expect("jobs" in doc || "runs" in doc).toBe(true);
    });
  }

  it("rejects an unquoted mapping indicator inside an expression", () => {
    // The shape that reached a pushed branch: a job `name` whose `${{ }}`
    // expression carried a `: ` inside an unquoted scalar. Pinned so the
    // positive cases above are known to be able to fail.
    const bad = [
      "jobs:",
      "  leg:",
      "    name: ${{ needs.x.outputs.y == 'true' && 'A (b: c)' || 'A' }}",
      "    runs-on: ubuntu-latest",
      "",
    ].join("\n");

    expect(() => load(bad)).toThrow();
  });
});
