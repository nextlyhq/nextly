/**
 * The guard as a real process sees it, rather than as a function call.
 *
 * The unit cases drive `isCliEntry` with a rewritten `argv[1]`; these run node
 * against a file on disk, which is the only way to observe the value the
 * runtime actually puts in `import.meta.url` — the half of the comparison a
 * test cannot fabricate.
 *
 * Every case asserts what the child PRINTED, never its status. A guard that
 * answers wrongly makes the module do nothing and exit 0, so status alone
 * cannot tell "ran and succeeded" from "declined to run".
 *
 * @module cli-entry.cli.test
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// As a URL, because a Windows absolute path is not a usable ESM specifier —
// `C:\...` reads as a protocol and the child exits before running anything.
const GUARD = pathToFileURL(path.join(HERE, "cli-entry.mjs")).href;

const made = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `cli-entry-${name}-`));
  made.push(dir);
  return dir;
}

/**
 * A module that prints RAN only when it is the entry, and always prints
 * LOADED.
 *
 * LOADED is the positive control. Without it, a child that crashed on import
 * and one whose guard correctly declined both produce no RAN, and the
 * negative case below would pass on a module that never executed at all.
 */
function fixture(dir, name = "entry.mjs") {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    [
      `import { isCliEntry } from ${JSON.stringify(GUARD)};`,
      `console.log("LOADED");`,
      `if (isCliEntry(import.meta.url)) console.log("RAN");`,
      "",
    ].join("\n")
  );
  return file;
}

function run(entry, nodeOptions = "") {
  const result = spawnSync(process.execPath, [entry], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });
  // stderr is folded in deliberately. A child that fails to import prints
  // there and nothing to stdout, which reads in an assertion as a guard that
  // declined — the two failures this file exists to separate.
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/** Symlink creation is a privilege on Windows, not a platform property. */
function canSymlink() {
  try {
    const dir = workspace("probe");
    const target = path.join(dir, "t.mjs");
    writeFileSync(target, "export default 1;\n");
    symlinkSync(target, path.join(dir, "l.mjs"));
    return true;
  } catch {
    return false;
  }
}

const SYMLINKS = canSymlink();

describe("a module run directly", () => {
  it("executes its CLI block", () => {
    const out = run(fixture(workspace("direct")));

    expect(out, "the module was reached at all").toContain("LOADED");
    expect(out, "and its CLI block ran").toContain("RAN");
  });

  it("executes it from a path containing a space", () => {
    // A repository checked out under `C:\Users\Some Name\...` is the ordinary
    // case on Windows, and the path it produces is the one an interpolated
    // `file://` comparison cannot encode.
    const dir = mkdtempSync(path.join(tmpdir(), "cli entry spaced "));
    made.push(dir);
    const out = run(fixture(dir));

    expect(out).toContain("LOADED");
    expect(out).toContain("RAN");
  });
});

describe("a module that is only imported", () => {
  it("does not execute its CLI block", () => {
    const dir = workspace("imported");
    const target = fixture(dir, "library.mjs");
    const importer = path.join(dir, "importer.mjs");
    writeFileSync(
      importer,
      `import ${JSON.stringify(pathToFileURL(target).href)};\nconsole.log("IMPORTER");\n`
    );

    const out = run(importer);

    // All three assertions are needed: IMPORTER proves the child ran, LOADED
    // proves it reached the module under test, and only then does the absence
    // of RAN mean the guard declined rather than that nothing happened.
    expect(out, "the importer ran").toContain("IMPORTER");
    expect(out, "and it loaded the module").toContain("LOADED");
    expect(out, "whose CLI block stayed quiet").not.toContain("RAN");
  });
});

describe.skipIf(!SYMLINKS)("a module run through a symlink", () => {
  // Both modes, through the same link. Each covers one half of the guard:
  // without the flag the runtime resolves `import.meta.url` while `argv[1]`
  // keeps the link; with it, the link survives in `import.meta.url` and the
  // resolved form is the one that misses. Exercising one mode alone leaves the
  // other half deletable with this file still green.
  for (const nodeOptions of ["", "--preserve-symlinks-main"]) {
    const mode = nodeOptions === "" ? "resolved by the runtime" : "preserved";

    it(`executes its CLI block when the link is ${mode}`, () => {
      const dir = workspace("symlink");
      const target = fixture(dir);
      const link = path.join(dir, "link.mjs");
      symlinkSync(target, link);

      const out = run(link, nodeOptions);

      expect(out).toContain("LOADED");
      expect(out).toContain("RAN");
    });
  }
});

/**
 * How a script REACHES the guard, which is a separate question from what the
 * guard answers.
 *
 * The cases above hand their fixture an absolute `file://` URL for the guard,
 * so they cannot see this at all: the specifier resolves the same way wherever
 * the module is. A script in `scripts/` names its neighbour instead, and a bare
 * `./cli-entry.mjs` is resolved against the specifier the runtime holds for the
 * module — which under `--preserve-symlinks-main` is the LINK. The neighbour is
 * then looked for beside the link, is not there, and the process dies with
 * `ERR_MODULE_NOT_FOUND` before a single line runs.
 *
 * That failure is louder than the one the guard itself has (exit 1 with a
 * stack, rather than a silent exit 0), which is exactly why it needs its own
 * cases: it kills the module at IMPORT time, so no assertion about the guard's
 * answer can reach it.
 */
describe.skipIf(!SYMLINKS)("a module that reaches the guard as a neighbour", () => {
  /**
   * A fixture that names the guard relatively, beside its own copy of it.
   *
   * `resolver` decides how the specifier is built, which is the whole subject
   * here: `"bare"` writes `./cli-entry.mjs`, `"realpath"` writes the form the
   * migrated scripts use.
   */
  function neighbourFixture(dir, resolver) {
    copyFileSync(path.join(HERE, "cli-entry.mjs"), path.join(dir, "cli-entry.mjs"));
    const file = path.join(dir, "entry.mjs");
    const lines =
      resolver === "bare"
        ? [`import { isCliEntry } from "./cli-entry.mjs";`]
        : [
            `import { realpathSync } from "node:fs";`,
            `import { dirname, join } from "node:path";`,
            `import { fileURLToPath, pathToFileURL } from "node:url";`,
            `const { isCliEntry } = await import(`,
            `  pathToFileURL(join(dirname(realpathSync(fileURLToPath(import.meta.url))), "cli-entry.mjs")).href`,
            `);`,
          ];
    writeFileSync(
      file,
      [
        ...lines,
        `console.log("LOADED");`,
        `if (isCliEntry(import.meta.url)) console.log("RAN");`,
        "",
      ].join("\n")
    );
    return file;
  }

  /** The link lives in its OWN directory, which is what leaves the neighbour behind. */
  function linkFromElsewhere(target, name) {
    const link = path.join(workspace(name), "linked.mjs");
    symlinkSync(target, link);
    return link;
  }

  it("survives a preserved symlink when it resolves through its real path", () => {
    const dir = workspace("neighbour-realpath");
    const link = linkFromElsewhere(neighbourFixture(dir, "realpath"), "elsewhere-ok");

    const out = run(link, "--preserve-symlinks-main");

    expect(out, "the module was reached").toContain("LOADED");
    expect(out, "and its CLI block ran").toContain("RAN");
  });

  it("does NOT survive one when it names the neighbour bare", () => {
    // The separating case. Without it the test above passes just as well on a
    // script that never had the problem, and says nothing about the resolution
    // that fixes it. This is the failure `ci-verdict.mjs` and
    // `verify-merge.mjs` actually took: the gate exits 1 on a module-not-found
    // instead of reaching its deliberate exit 2.
    const dir = workspace("neighbour-bare");
    const link = linkFromElsewhere(neighbourFixture(dir, "bare"), "elsewhere-broken");

    const out = run(link, "--preserve-symlinks-main");

    expect(out, "it died before running").not.toContain("LOADED");
    expect(out).toContain("ERR_MODULE_NOT_FOUND");
  });
});
