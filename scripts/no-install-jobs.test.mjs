/**
 * Every script a workflow runs without installing dependencies imports only Node builtins.
 *
 * The unit cases pin the reader and the walker against the ways each could pass while broken. The
 * last block applies them to the real workflows, which is the check itself.
 *
 * @module no-install-jobs.test
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  installsDependencies,
  moduleSpecifiers,
  noInstallEntries,
  nodeEntries,
  nonBuiltinImports,
} from "./no-install-jobs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const step = block => ({ name: null, block });

describe("installsDependencies and nodeEntries", () => {
  it("recognises an install in the forms a workflow writes it", () => {
    for (const block of ["pnpm install --frozen-lockfile", "npm ci", "cd app && pnpm i"]) {
      expect(installsDependencies([step(block)]), block).toBe(true);
    }
  });

  it("does not read a shell comment or a longer command as an install", () => {
    expect(installsDependencies([step("# pnpm install runs in the other job")])).toBe(false);
    expect(installsDependencies([step("pnpm install-completion")])).toBe(false);
  });

  it("reads the file each node invocation starts, flags included, comments excluded", () => {
    const entries = nodeEntries([
      step("node scripts/a.mjs"),
      step("node --enable-source-maps scripts/b.mjs --json\n# node scripts/c.mjs"),
    ]);

    expect(entries).toEqual(["scripts/a.mjs", "scripts/b.mjs"]);
  });
});

describe("noInstallEntries", () => {
  const workflow = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: node scripts/build.mjs",
    "  integration:",
    "    steps:",
    "      - uses: ./.github/actions/setup",
    "      - run: node scripts/integration.mjs",
    "  gate:",
    "    # No pnpm install here: the verdict reads nothing it would provide.",
    "    steps:",
    "      - run: node scripts/gate.mjs",
    "",
  ].join("\n");
  const installingAction = "runs:\n  steps:\n    - run: pnpm install --frozen-lockfile\n";

  it("returns only jobs that neither install nor call a local action that does", () => {
    const found = noInstallEntries(workflow, dir =>
      dir === ".github/actions/setup" ? installingAction : null
    );

    expect(found).toEqual([{ job: "gate", entries: ["scripts/gate.mjs"] }]);
  });

  it("checks a job whose action it cannot read, rather than excusing it", () => {
    const found = noInstallEntries(workflow, () => null);

    expect(found.map(entry => entry.job)).toEqual(["integration", "gate"]);
  });
});

describe("moduleSpecifiers", () => {
  it("does NOT read an import quoted in a comment or a string", () => {
    const { literal } = moduleSpecifiers(
      "f.mjs",
      '// import { compile } from "@mdx-js/mdx";\nconst s = \'import x from "js-yaml"\';\nimport { readFileSync } from "node:fs";\n'
    );

    expect(literal).toEqual(["node:fs"]);
  });

  it("reads re-exports, side-effect imports and a literal dynamic import", () => {
    const { literal } = moduleSpecifiers(
      "f.mjs",
      'export { a } from "./a.mjs";\nexport * from "pkg-a";\nimport "pkg-b";\nawait import("pkg-c");\n'
    );

    expect(literal).toEqual(["./a.mjs", "pkg-a", "pkg-b", "pkg-c"]);
  });

  it("reports an import() it cannot follow instead of dropping it", () => {
    const found = moduleSpecifiers("f.mjs", 'const name = "js-yaml";\nawait import(name);\n');

    expect(found.literal).toEqual([]);
    expect(found.unresolvable).toEqual(["import(name)"]);
  });
});

describe("nonBuiltinImports", () => {
  const files = {
    "scripts/entry.mjs": 'import { x } from "./middle.mjs";\nimport { join } from "node:path";\n',
    "scripts/middle.mjs": 'export { x } from "./leaf.mjs";\n',
    "scripts/leaf.mjs": 'import yaml from "js-yaml";\nexport const x = yaml;\n',
    "scripts/clean.mjs": 'import { readFileSync } from "node:fs";\nimport { b } from "./cycle.mjs";\n',
    "scripts/cycle.mjs": 'import { readFileSync } from "fs";\nexport { b } from "./clean.mjs";\n',
  };
  const read = file => {
    if (!(file in files)) throw new Error(`no such file: ${file}`);
    return files[file];
  };

  it("finds an npm import two files down, through a re-export", () => {
    const { offenders } = nonBuiltinImports("scripts/entry.mjs", read);

    expect(offenders).toEqual(["scripts/leaf.mjs imports js-yaml"]);
  });

  it("passes a graph of builtins, prefixed or not, and terminates on a cycle", () => {
    const { files: reached, offenders } = nonBuiltinImports("scripts/clean.mjs", read);

    expect(offenders).toEqual([]);
    expect(reached.sort()).toEqual(["scripts/clean.mjs", "scripts/cycle.mjs"]);
  });

  it("reports a relative import it cannot read", () => {
    const { offenders } = nonBuiltinImports("scripts/absent.mjs", read);

    expect(offenders).toEqual(["scripts/absent.mjs: cannot be read"]);
  });
});

describe("the real workflows", () => {
  const workflowDir = path.join(ROOT, ".github", "workflows");
  const workflows = readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name)).sort();
  const readRepo = relative => readFileSync(path.join(ROOT, relative), "utf8");
  const readAction = dir => {
    for (const name of ["action.yml", "action.yaml"]) {
      try {
        return readRepo(path.join(dir, name));
      } catch {
        // Try the other spelling.
      }
    }
    return null;
  };
  const population = workflows.flatMap(file =>
    noInstallEntries(readRepo(path.join(".github", "workflows", file)), readAction).flatMap(
      ({ job, entries }) => entries.map(entry => ({ where: `${file} ${job}`, entry }))
    )
  );

  /**
   * A FLOOR, not the population. Every assertion below iterates what the workflows actually run;
   * this exists so a reader that silently found nothing cannot satisfy them by leaving nothing to
   * iterate.
   */
  const AT_LEAST = ["scripts/ci-gate.mjs", "scripts/check-repo-metadata.mjs"];

  it("finds the jobs known to run without installing", () => {
    const entries = population.map(item => item.entry);

    for (const expected of AT_LEAST) expect(entries, expected).toContain(expected);
  });

  it("does not mistake an installing job for one that runs without installing", () => {
    // The other direction. A reader that stopped recognising installs would put every job's
    // scripts in the population, and the check would start failing on correct files.
    const entries = population.map(item => item.entry);

    expect(entries).not.toContain("scripts/release/check-changesets.mjs");
  });

  it.each(population.map(item => [item.where, item.entry]))(
    "%s starts %s, which imports only Node builtins",
    (_where, entry) => {
      const { offenders } = nonBuiltinImports(entry, readRepo);

      expect(
        offenders,
        "this job installs no dependencies, so Node alone loads this whole import graph. " +
          "Import a dependency-free module instead, or give the job an install step."
      ).toEqual([]);
    }
  );
});
