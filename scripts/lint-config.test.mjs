// Which files the repository's guarded lint rules reach, read from oxlint
// itself running the committed configuration (oxlint.config.mjs).
//
// Each guard has an allowlist: files that may still do what it forbids. For
// each, two runs over the allowlisted files answer the two questions that
// matter. The committed configuration reports nothing there, so the
// exemption is what suppresses the rule. A configuration derived from it with
// that rule's exemptions removed, and nothing else changed, reports there, so
// the committed `files` globs reach those files and the rule is live on them.
// For the bare-Error guard it reports exactly the pinned number of throws per
// file, so an allowlisted file can neither gain a throw nor keep an entry it
// no longer needs.
//
// What each rule matches is lint-guards.test.mjs's question.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import committed from "../oxlint.config.mjs";

const root = join(import.meta.dirname, "..");
const nextly = join(root, "packages/nextly");
const oxlint = join(root, "node_modules/.bin/oxlint");

const readJson = path => JSON.parse(readFileSync(path, "utf8"));

// Files that still throw a built-in error, each with how many throws it may
// keep. The number may only go down: an added entry is a new bare throw.
const EXPECTED_BARE_ERROR_FILES = 86;
const BARE_ERROR_ALLOWLIST = readJson(
  join(nextly, "bare-error-allowlist.json")
);
const CONSOLE_ALLOWLIST = readJson(
  join(nextly, "console-allowlist.json")
).terminal;
const API_KEY_SCOPE_FILES = [
  "src/auth/authenticated-scope.ts",
  "src/dispatcher/helpers/authenticated-actor.ts",
];

/** The one override in the committed configuration that turns `rule` on. */
function overrideFor(rule) {
  const found = committed.overrides.filter(
    override => override.rules?.[rule] !== undefined
  );
  expect(found, `exactly one override turns ${rule} on`).toHaveLength(1);
  return found[0];
}

/**
 * Lints `files` (repository-relative) with `config`, and returns the
 * diagnostics and how many files were linted.
 *
 * The configuration is written beside the committed one, because oxlint reads
 * its globs and plugin paths from where the file is. It is removed afterwards
 * whatever happens.
 *
 * Type-aware rules are switched off for the run: every guard asked about here
 * reads syntax alone, and without them the answer needs no build, which the CI
 * step that runs this suite does not have.
 */
function lint(config, files) {
  const path = join(
    root,
    `.oxlint-test-${process.pid}-${Math.random().toString(36).slice(2)}.config.mjs`
  );
  const syntactic = {
    ...config,
    options: { ...config.options, typeAware: false },
  };
  writeFileSync(path, `export default ${JSON.stringify(syntactic)};\n`);
  try {
    let stdout;
    try {
      stdout = execFileSync(oxlint, ["-c", path, "-f", "json", ...files], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      // Exit 1 means it found something, which is an answer, not a failure.
      if (error.status !== 1 || !error.stdout) throw error;
      stdout = error.stdout;
    }
    const report = JSON.parse(stdout);
    return { diagnostics: report.diagnostics, files: report.number_of_files };
  } finally {
    rmSync(path, { force: true });
  }
}

/** The committed configuration with `rule`'s exemptions removed. */
function withoutExemptions(rule) {
  const config = structuredClone(committed);
  const override = config.overrides.find(o => o.rules?.[rule] !== undefined);
  override.excludeFiles = (override.excludeFiles ?? []).filter(
    pattern => !pattern.startsWith("packages/nextly/src/") || /\*/.test(pattern)
  );
  return config;
}

/** Diagnostics from `rule`, counted per repository-relative file. */
function countsPerFile(diagnostics, rule) {
  const counts = {};
  for (const d of diagnostics) {
    if (d.code !== rule) continue;
    counts[d.filename] = (counts[d.filename] ?? 0) + 1;
  }
  return counts;
}

describe("the bare-Error guard's allowlist", () => {
  const files = Object.keys(BARE_ERROR_ALLOWLIST).map(
    f => `packages/nextly/${f}`
  );

  it("holds no more entries than have been accepted", () => {
    expect(
      files.length,
      `If files were cleaned, lower EXPECTED_BARE_ERROR_FILES to match. If one was ADDED, ` +
        `convert it to NextlyError instead: this number may only go down.`
    ).toBe(EXPECTED_BARE_ERROR_FILES);
  });

  it("exempts each file for exactly the throws it had, no more and no fewer", () => {
    // The committed `files` glob reaches every one of them, and the throws
    // counted there are the throws the allowlist pins.
    const { diagnostics, files: linted } = lint(
      withoutExemptions("nextly/no-bare-error"),
      files
    );
    // A file lint skips altogether is no exemption at all: it would never go
    // stale, since it does contain a real throw.
    expect(linted, "every allowlisted file is one lint reads").toBe(
      files.length
    );
    const counts = countsPerFile(diagnostics, "nextly(no-bare-error)");
    const drifted = Object.entries(BARE_ERROR_ALLOWLIST)
      .filter(
        ([f, allowed]) => (counts[`packages/nextly/${f}`] ?? 0) !== allowed
      )
      .map(
        ([f, allowed]) =>
          `${f}: allowed ${allowed}, found ${counts[`packages/nextly/${f}`] ?? 0}`
      );
    expect(
      drifted,
      "A LOWER count means a file was cleaned: lower its number, or remove it at zero. A " +
        "HIGHER count means a new bare throw: use NextlyError instead."
    ).toEqual([]);
  }, 120_000);

  it("is what suppresses the guard on those files", () => {
    const { diagnostics } = lint(committed, files);
    expect(countsPerFile(diagnostics, "nextly(no-bare-error)")).toEqual({});
  }, 120_000);
});

describe("the console guard's allowlist", () => {
  // The files the terminal globs name today, each of which does write.
  const files = [
    "packages/nextly/src/plugins/test-nextly.ts",
    "packages/nextly/src/observability/logger.ts",
    "packages/nextly/src/shared/types/index.ts",
    "packages/nextly/src/shared/lib/logger.ts",
    "packages/nextly/src/domains/email/services/providers/log-provider.ts",
  ];

  it("names only paths that exist, each with its reason", () => {
    // A stale entry would exempt whatever later appears at that path.
    for (const [entry, reason] of Object.entries(CONSOLE_ALLOWLIST)) {
      expect(
        existsSync(join(nextly, entry.replace(/\/\*\*$/, ""))),
        entry
      ).toBe(true);
      expect(typeof reason === "string" && reason.trim() !== "", entry).toBe(
        true
      );
    }
  });

  it("is what suppresses the guard on the terminal files", () => {
    const off = lint(committed, files);
    expect(countsPerFile(off.diagnostics, "eslint(no-console)")).toEqual({});
    expect(
      countsPerFile(off.diagnostics, "eslint(no-restricted-globals)")
    ).toEqual({});

    // Without the exemptions, the guard reports on every one: through
    // `no-console` where a file calls the console, through
    // `no-restricted-globals` where it hands the console over as a value.
    const on = lint(withoutExemptions("no-console"), files);
    const calls = countsPerFile(on.diagnostics, "eslint(no-console)");
    const values = countsPerFile(
      on.diagnostics,
      "eslint(no-restricted-globals)"
    );
    expect(
      files.filter(file => !calls[file] && !values[file]),
      "terminal files the guard does not reach"
    ).toEqual([]);
    expect(
      Object.keys(calls).length,
      "no-console reports somewhere"
    ).toBeGreaterThan(0);
  }, 120_000);
});

describe("the API-key scope guard's allowlist", () => {
  const files = API_KEY_SCOPE_FILES.map(f => `packages/nextly/${f}`);

  it("names the same files the configuration exempts", () => {
    expect(overrideFor("nextly/api-key-scope").excludeFiles).toEqual(
      expect.arrayContaining(files)
    );
  });

  it("is what suppresses the guard on those files", () => {
    const off = lint(committed, files);
    expect(countsPerFile(off.diagnostics, "nextly(api-key-scope)")).toEqual({});
    const on = lint(withoutExemptions("nextly/api-key-scope"), files);
    expect(
      Object.keys(countsPerFile(on.diagnostics, "nextly(api-key-scope)")).sort()
    ).toEqual([...files].sort());
  }, 120_000);

  it("exempts a file from the scope guard only, not from the bare-Error guard", () => {
    // Overrides combine per rule: exempting a file from one guard must leave
    // the others on it.
    for (const file of files) {
      expect(overrideFor("nextly/no-bare-error").excludeFiles).not.toContain(
        file
      );
    }
  });
});
