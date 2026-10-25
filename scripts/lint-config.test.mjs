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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  IMPORT_CYCLES,
  NEXTLY_SOURCE,
  NO_CYCLE,
} from "../lint/import-cycles.mjs";
import committed from "../oxlint.config.mjs";
import { everyPass, oxlintCommand, TEMPLATES_PASS } from "./lint.mjs";

const root = join(import.meta.dirname, "..");
const nextly = join(root, "packages/nextly");
// Run as lint.mjs runs it, by Node, which works on Windows as well.
const [node, oxlint] = oxlintCommand();

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
  writeFileSync(
    path,
    `export default ${JSON.stringify(syntacticOnly(config))};\n`
  );
  try {
    const report = runOxlint(["-c", path, "-f", "json", ...files], root);
    return { diagnostics: report.diagnostics, files: report.number_of_files };
  } finally {
    rmSync(path, { force: true });
  }
}

/** `config` with the type-aware rules off, as every run here lints. */
function syntacticOnly(config) {
  return { ...config, options: { ...config.options, typeAware: false } };
}

/** `config` with each plugin a relative path names given its absolute one here. */
function withRootPlugins(config) {
  const absolute = specifier =>
    specifier.startsWith(".") ? join(root, specifier) : specifier;
  return {
    ...config,
    jsPlugins: config.jsPlugins.map(plugin =>
      typeof plugin === "string"
        ? absolute(plugin)
        : { ...plugin, specifier: absolute(plugin.specifier) }
    ),
  };
}

/** Runs oxlint from `cwd` and returns its JSON report. */
function runOxlint(args, cwd) {
  try {
    return JSON.parse(
      execFileSync(node, [oxlint, ...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
    );
  } catch (error) {
    // Exit 1 means it found something, which is an answer, not a failure.
    if (error.status !== 1 || !error.stdout) throw error;
    return JSON.parse(error.stdout);
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

/**
 * Lints each probe with the committed configuration, in a directory of its own
 * laid out like the repository, so the `files` globs reach a probe exactly as
 * they would the same path here. The directory is under the repository's
 * `.turbo`, which git and every scan of the tree ignore, so no other suite
 * sees a probe come and go; and the plugins a package name names resolve
 * upwards from it as they do here. (Not under `node_modules`: oxlint lints a
 * file there without its React rules.) A plugin named by a relative path is
 * given its absolute one. The directory is the only thing removed.
 */
function lintProbes(probes, config = committed) {
  const parent = join(root, ".turbo");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "lint-probes-"));
  try {
    for (const [path, source] of Object.entries(probes)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), source, { flag: "wx" });
    }
    const written = join(dir, "oxlint.config.mjs");
    writeFileSync(
      written,
      `export default ${JSON.stringify(withRootPlugins(syntacticOnly(config)))};\n`,
      { flag: "wx" }
    );
    const report = runOxlint(
      ["-c", written, "-f", "json", ...Object.keys(probes)],
      dir
    );
    expect(report.number_of_files, "every probe is a file lint reads").toBe(
      Object.keys(probes).length
    );
    return report.diagnostics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

describe("the boot modules' exemption from the request-path imports guard", () => {
  // The two boot modules may load the migrate CLI only through `import()`:
  // they are taken out of `no-restricted-imports`, which also refuses that
  // form, and given the static-only rule with the same patterns instead.
  // Exempting them from both would let a static import in.
  it("hands every exempted file the static-only rule, over the same patterns", () => {
    const restricted = overrideFor("no-restricted-imports");
    const staticOnly = overrideFor("nextly/no-static-restricted-import");
    expect(staticOnly.files.sort()).toEqual(
      [...restricted.excludeFiles].sort()
    );
    expect(
      staticOnly.rules["nextly/no-static-restricted-import"][1].patterns
    ).toEqual(restricted.rules["no-restricted-imports"][1].patterns);
  });
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

describe("the import-cycle guard's allowlist", () => {
  const listed = IMPORT_CYCLES.flat().map(file => `${NEXTLY_SOURCE}/${file}`);

  /**
   * The cycles `import/no-cycle` reports, as groups of files: each report
   * prints the path of one cycle through its file, and files joined by any
   * printed path are one group. Read from oxlint's own reports so the cycles
   * come from the graph the lint uses rather than a second one built here.
   */
  function cycleGroups(diagnostics) {
    const at = new RegExp(`\\((${NEXTLY_SOURCE}/[^)]+)\\)`, "g");
    const parent = new Map();
    const find = file => {
      if (!parent.has(file)) parent.set(file, file);
      while (parent.get(file) !== file) file = parent.get(file);
      return file;
    };
    for (const report of diagnostics) {
      if (report.code !== "import(no-cycle)") continue;
      const path = [...(report.note ?? "").matchAll(at)].map(match => match[1]);
      // A report whose path cannot be read would join nothing and make every
      // group look smaller, so a change in how oxlint prints it fails here.
      expect(
        path.length,
        `no cycle path read from ${report.filename}`
      ).toBeGreaterThan(0);
      for (const file of path) parent.set(find(file), find(report.filename));
    }
    const groups = new Map();
    for (const file of parent.keys()) {
      groups.set(find(file), [...(groups.get(find(file)) ?? []), file]);
    }
    return [...groups.values()].map(group => group.sort()).sort();
  }

  it("is the setting the configuration lints nextly's source with", () => {
    const override = overrideFor("import/no-cycle");
    expect(override.rules["import/no-cycle"]).toEqual(NO_CYCLE);
    expect(override.files).toEqual([`${NEXTLY_SOURCE}/**/*.{ts,tsx}`]);
    expect([...override.excludeFiles].sort()).toEqual([...listed].sort());
  });

  it("is what suppresses the guard on the listed files", () => {
    const off = lint(committed, listed);
    expect(off.files).toBe(listed.length);
    expect(countsPerFile(off.diagnostics, "import(no-cycle)")).toEqual({});
  }, 120_000);

  it("lists exactly the cycles nextly's source has", () => {
    // With the exemptions removed, every file on a cycle is reported. The
    // groups must equal the listed ones: a file that joined a cycle, two cycles
    // that merged, and a file that left one all change them. A merge is the
    // case the per-file exemption alone cannot see, since every merged file is
    // already exempt; fallow's new-only circular-dependency check reports it
    // too, as an introduced cycle.
    const on = lint(withoutExemptions("import/no-cycle"), [NEXTLY_SOURCE]);
    const found = cycleGroups(on.diagnostics);
    const expected = IMPORT_CYCLES.map(group =>
      group.map(file => `${NEXTLY_SOURCE}/${file}`).sort()
    ).sort();
    const foundFiles = new Set(found.flat());
    const joined = found.flat().filter(file => !listed.includes(file));
    const left = listed.filter(file => !foundFiles.has(file));
    expect(
      found,
      [
        "The import cycles in nextly's source differ from lint/import-cycles.mjs.",
        left.length
          ? `No longer on a cycle, so remove them from the list: ${left.join(", ")}.`
          : "",
        joined.length
          ? `Newly on a cycle: ${joined.join(", ")}. Make the import that closed it ` +
            "type-only, or load it with import() inside the function that needs it."
          : "",
        !left.length && !joined.length
          ? "Two listed cycles merged, or one split: the groups changed with the same files."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    ).toEqual(expected);
  }, 120_000);
});

// Each guard above is shown live at a path no allowlist names: a probe doing
// what the guard forbids, written where the committed `files` reach, must be
// reported there. The checks above remove exemptions from allowlisted files;
// these hold the guard to new code, where it matters most. The static-only
// imports rule has no such path: its `files` are exactly the two boot modules.
describe("each guard, at a path no allowlist names", () => {
  const src = "packages/nextly/src";
  const probes = {
    "nextly(no-bare-error)": [
      `${src}/lint-probe-bare-error.ts`,
      'export function probe(): never {\n  throw new Error("probe");\n}\n',
    ],
    "nextly(api-key-scope)": [
      `${src}/lint-probe-api-key-scope.ts`,
      'export const scope = { actorType: "apiKey", permissions: [] };\n',
    ],
    "eslint(no-console)": [
      `${src}/lint-probe-console-call.ts`,
      'export function probe(): void {\n  console.log("probe");\n}\n',
    ],
    "eslint(no-restricted-globals)": [
      `${src}/lint-probe-console-value.ts`,
      "export const sink = console;\n",
    ],
    "eslint(no-restricted-imports)": [
      `${src}/api/lint-probe-migrate-import.ts`,
      'export { runMigrate } from "../cli/commands/migrate";\n',
    ],
    "nextly(no-eager-dynamic-import)": [
      `${src}/lint-probe-eager-import.ts`,
      'export const loaded = await import("./lint-probe-console-value");\n',
    ],
    "import(no-cycle)": [
      `${src}/lint-probe-cycle-a.ts`,
      'import { b } from "./lint-probe-cycle-b";\nexport const a = () => b;\n',
    ],
  };
  // The other half of the cycle the no-cycle probe closes.
  const cycleBack = {
    [`${src}/lint-probe-cycle-b.ts`]:
      'import { a } from "./lint-probe-cycle-a";\nexport const b = () => a;\n',
  };

  it("reports each forbidden construct in the file it was written to", () => {
    const diagnostics = lintProbes({
      ...Object.fromEntries(Object.values(probes)),
      ...cycleBack,
    });
    for (const [rule, [path]] of Object.entries(probes)) {
      expect(
        countsPerFile(diagnostics, rule)[path] ?? 0,
        `${rule} at ${path}`
      ).toBeGreaterThan(0);
    }
  }, 120_000);
});

// The tab-indicator guard reads every file a call site can live in: each
// extension JSX is legal in, outside `src` as well as in it, and in an app as
// well as a package. A path the committed `files` miss is a call site never
// read, and the repository-wide silence would look the same.
describe("the tab-indicator guard, wherever a call site can live", () => {
  const violation = ext =>
    `import { TabsTrigger } from "@nextlyhq/ui";\nexport const probe = <TabsTrigger value="a" className="border-b-0" />;\n// ${ext}\n`;
  const probes = {
    "packages/admin/src/lint-probe-tab.tsx": violation("tsx"),
    "packages/create-nextly-app/examples/lint-probe-tab.jsx": violation("jsx"),
    "apps/playground/app/lint-probe-tab.js": violation("js"),
    // Named like build output, and an ordinary route segment all the same.
    "apps/playground/app/build/lint-probe-tab.tsx": violation("tsx"),
  };

  it("reports a repainted indicator in each of them", () => {
    const counts = countsPerFile(lintProbes(probes), "nextly(tab-indicator)");
    expect(counts).toEqual(
      Object.fromEntries(Object.keys(probes).map(path => [path, 1]))
    );
  }, 120_000);

  // A scaffolded project depends on `@nextlyhq/ui`, so a template is a call
  // site too. The repository's configuration ignores the templates, so they
  // are read by a pass of their own, with its own configuration.
  it("reports one in a scaffold template, through the pass `pnpm lint` runs there", async () => {
    expect(everyPass()).toContainEqual(TEMPLATES_PASS);
    const [, configFile, templates] = TEMPLATES_PASS;
    const { default: config } = await import(
      pathToFileURL(join(root, configFile)).href
    );
    const probe = `${templates}/base/src/app/lint-probe-tab.tsx`;
    const counts = countsPerFile(
      lintProbes({ [probe]: violation("tsx") }, config),
      "nextly(tab-indicator)"
    );
    expect(counts).toEqual({ [probe]: 1 });
  }, 120_000);
});

// The playground's React Compiler and accessibility rules, each shown to report
// on a construct it exists to catch. The rules come from the playground's own
// override, so a rule turned on there without a probe here, or a probe whose
// rule is off, fails the first test.
describe("the playground's React Compiler and accessibility rules", () => {
  const PROBES = {
    "react/error-boundaries":
      "function Child() {\n  return <div />;\n}\nexport function Probe() {\n  try {\n    return <Child />;\n  } catch {\n    return null;\n  }\n}\n",
    "react/globals":
      "let renders = 0;\nexport function Probe() {\n  renders = renders + 1;\n  return <div>{renders}</div>;\n}\n",
    "react/immutability":
      'import { useState } from "react";\nexport function Probe() {\n  const [state] = useState({ count: 0 });\n  state.count = 1;\n  return <div>{state.count}</div>;\n}\n',
    "react/incompatible-library":
      'import { useForm } from "react-hook-form";\nexport function Probe() {\n  const { watch } = useForm();\n  return <div>{String(watch("x"))}</div>;\n}\n',
    "react/preserve-manual-memoization":
      'import { useMemo } from "react";\nexport function useProbe() {\n  const { data } = useStats();\n  return useMemo(() => {\n    const map = new Map<string, number>();\n    if (!data?.items) return map;\n    for (const item of data.items) map.set(String(item), item);\n    return map;\n  }, [data?.items]);\n}\nfunction useStats(): { data?: { items?: number[] } } {\n  return {};\n}\n',
    "react/purity":
      "export function Probe() {\n  const now = Date.now();\n  return <div>{now}</div>;\n}\n",
    "react/refs":
      'import { useRef } from "react";\nexport function Probe() {\n  const ref = useRef(0);\n  return <div>{ref.current}</div>;\n}\n',
    "react/set-state-in-effect":
      'import { useEffect, useState } from "react";\nexport function Probe() {\n  const [value, setValue] = useState(0);\n  useEffect(() => {\n    setValue(1);\n  }, []);\n  return <div>{value}</div>;\n}\n',
    "react/set-state-in-render":
      'import { useState } from "react";\nexport function Probe() {\n  const [value, setValue] = useState(0);\n  setValue(1);\n  return <div>{value}</div>;\n}\n',
    "react/static-components":
      "export function Probe() {\n  const Inner = () => <span />;\n  return <Inner />;\n}\n",
    "react/unsupported-syntax":
      'export function Probe() {\n  const value = eval("1");\n  return <div>{value}</div>;\n}\n',
    "react/use-memo":
      'import { useMemo } from "react";\nexport function Probe({ n }: { n: Promise<number> }) {\n  const value = useMemo(async () => {\n    await n;\n  }, [n]);\n  return <div>{String(value)}</div>;\n}\n',
    // Both elements: `Image` is reported only through the rule's options.
    "jsx-a11y/alt-text":
      'import Image from "next/image";\nexport function Probe() {\n  return (\n    <>\n      <img src="/x.png" />\n      <Image src="/x.png" width={1} height={1} />\n    </>\n  );\n}\n',
    "jsx-a11y/aria-props":
      'export function Probe() {\n  return <div aria-labeledby="x" />;\n}\n',
    "jsx-a11y/aria-proptypes":
      'export function Probe() {\n  return <div aria-hidden="maybe" />;\n}\n',
    "jsx-a11y/aria-unsupported-elements":
      'export function Probe() {\n  return <meta aria-hidden="true" />;\n}\n',
    "jsx-a11y/role-has-required-aria-props":
      'export function Probe() {\n  return <div role="checkbox" />;\n}\n',
    "jsx-a11y/role-supports-aria-props":
      'export function Probe() {\n  return <li aria-required="true" />;\n}\n',
  };
  // How many reports each probe must produce, where it is more than one.
  const EXPECTED_REPORTS = { "jsx-a11y/alt-text": 2 };

  // The override that turns the accessibility rules on is the playground's.
  const playground = overrideFor("jsx-a11y/alt-text");

  // The playground's own React and accessibility rules: every other React
  // rule is turned on for all React packages, in an override of its own.
  const rulesOn = Object.keys(playground.rules).filter(rule =>
    /^(react|jsx-a11y)\//.test(rule)
  );

  it("has a probe for exactly the React and accessibility rules the playground turns on", () => {
    expect([...rulesOn].sort()).toEqual(Object.keys(PROBES).sort());
  });

  it("reports each probe's construct, in its own file, through its own rule", () => {
    const paths = Object.fromEntries(
      Object.keys(PROBES).map(rule => [
        rule,
        `apps/playground/src/lint-probe-${rule.replace("/", "-")}.tsx`,
      ])
    );
    const diagnostics = lintProbes(
      Object.fromEntries(
        Object.entries(PROBES).map(([rule, source]) => [paths[rule], source])
      )
    );
    for (const [rule, path] of Object.entries(paths)) {
      const [plugin, name] = rule.split("/");
      expect(
        countsPerFile(diagnostics, `${plugin}(${name})`)[path] ?? 0,
        `${rule} at ${path}`
      ).toBe(EXPECTED_REPORTS[rule] ?? 1);
    }
  }, 120_000);
});
