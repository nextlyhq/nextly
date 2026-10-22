// `pnpm lint` runs oxlint in several passes (scripts/lint.mjs). Together they
// must lint exactly the files one pass over the repository lints: a file no
// pass reaches is never linted, and one two passes reach is linted twice.
//
// The files are read from oxlint itself, through a throwaway plugin that
// reports each file it visits, so the comparison is of what oxlint actually
// linted rather than of what the paths look like they cover.
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import committed from "../oxlint.config.mjs";
import { NAMED_PASSES, passes } from "./lint.mjs";

const root = join(import.meta.dirname, "..");
const oxlint = join(root, "node_modules/.bin/oxlint");
const id = `${process.pid}-${Math.random().toString(36).slice(2)}`;

// Written beside the committed configuration, because oxlint resolves a
// configuration's globs and plugin paths from where the file is.
const plugin = join(root, `.oxlint-test-files-${id}.mjs`);
const config = join(root, `.oxlint-test-files-${id}.config.mjs`);
writeFileSync(
  plugin,
  `export default { meta: { name: "visited" }, rules: { file: { create(context) {
    return { Program(node) { context.report({ node, message: "visited" }); } };
  } } } };\n`,
  { flag: "wx" }
);
// Type-aware rules off: which files a pass visits does not depend on them, and
// without them the passes need no build.
writeFileSync(
  config,
  `export default ${JSON.stringify({
    ...committed,
    options: { ...committed.options, typeAware: false, maxWarnings: undefined },
    jsPlugins: [...committed.jsPlugins, `./.oxlint-test-files-${id}.mjs`],
    rules: { ...committed.rules, "visited/file": "error" },
  })};\n`,
  { flag: "wx" }
);
afterAll(() => {
  rmSync(plugin, { force: true });
  rmSync(config, { force: true });
});

/** The files one oxlint run visits, each as often as it was visited. */
function visited(args) {
  let stdout;
  try {
    stdout = execFileSync(oxlint, [...args, "-f", "json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    // Exit 1 is the plugin reporting, which is the answer.
    if (error.status !== 1 || !error.stdout) throw error;
    stdout = error.stdout;
  }
  return JSON.parse(stdout)
    .diagnostics.filter(d => d.code === "visited(file)")
    .map(d => d.filename);
}

describe("the lint passes", () => {
  it("name each path once, and the last pass ignores every one of them", () => {
    const named = NAMED_PASSES.flat();
    expect(new Set(named).size).toBe(named.length);
    const last = passes("c.mjs").at(-1);
    for (const path of named) expect(last).toContain(`${path}/**`);
  });

  it(
    "lint exactly the files one pass over the repository lints, each once",
    () => {
      const whole = visited(["-c", config, "."]);
      // The control: the plugin reports, and from more than one package.
      expect(whole.length).toBeGreaterThan(1000);
      expect(new Set(whole).size).toBe(whole.length);

      const split = passes(config).flatMap(args => visited(args));
      const counts = new Map();
      for (const file of split) counts.set(file, (counts.get(file) ?? 0) + 1);
      expect(
        [...counts].filter(([, n]) => n > 1).map(([file]) => file),
        "files more than one pass lints"
      ).toEqual([]);
      expect([...counts.keys()].sort()).toEqual([...whole].sort());
      // Each pass reaches something, so none is a path that stopped existing.
      for (const args of passes(config)) expect(visited(args).length).toBeGreaterThan(0);
    },
    180_000
  );
});
