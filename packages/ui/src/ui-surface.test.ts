/**
 * The UI kit's export surface is a contract.
 *
 * `@nextlyhq/ui` is the presentational half of the plugin-author API: every
 * plugin's admin components compile against these exports, so removing or
 * renaming one breaks installed plugins on a host upgrade. The exported names
 * of each published entry point are snapshotted, so any change to the surface
 * has to be made deliberately, and the source is cross-checked against
 * `STABILITY.md` in both directions so the ledger and the code cannot drift.
 *
 * It reads the source rather than importing it: the root barrel is published
 * with `"use client"` and pulls in the whole component tree, which does not
 * belong in a Node test process.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { publishedEntries } from "../scripts/published-entries.mjs";

import {
  DECLARATION_ENTRIES,
  ensureDeclarations,
} from "./__tests__/ensure-declarations";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(SRC, "..");

/**
 * The SOURCE barrel behind each published entry point.
 *
 * Listed rather than derived, because the export map names built files and there is no convention
 * mapping `dist/color` back to `src/lib/color/index.ts`. The list is instead tied to the export
 * map by a completeness check below, so an entry point cannot be published without one.
 */
const ENTRY_POINTS = [
  "index.ts",
  "lib/utils.ts",
  "tailwind-preset.ts",
  "lib/color/index.ts",
];

/**
 * Strip comments before any structural check. Doc comments here legitimately
 * contain `export default …` and `export *` in usage examples, so matching the
 * raw text would both fire on prose and keep passing after the real export it
 * describes was deleted.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceOf(file: string): string {
  return stripComments(readFileSync(path.join(SRC, file), "utf8"));
}

/**
 * Extract each export as `"<name> (value|type)"` from a module's source. Covers
 * the export forms this package uses: `export { … } from`, `export type { … }
 * from`, inline `export { type X }` (with `as` aliases), and `export
 * function/class/const/interface/enum/type X`.
 *
 * The kind is tracked, not just the name, so converting a runtime value export
 * to a type-only export (or back) changes the snapshot — that swap keeps the
 * name but can break a consumer at runtime, so it must not pass silently.
 */
function exportedNames(file: string): string[] {
  const source = sourceOf(file);
  const kinds = new Map<string, "value" | "type">();

  for (const m of source.matchAll(/export\s+(type\s+)?\{([\s\S]*?)\}/g)) {
    const blockIsType = Boolean(m[1]);
    for (const raw of m[2].split(",")) {
      let entry = raw.trim();
      if (!entry) continue;
      let kind: "value" | "type" = blockIsType ? "type" : "value";
      if (/^type\s+/.test(entry)) {
        kind = "type";
        entry = entry.replace(/^type\s+/, "");
      }
      const asMatch = entry.match(/\bas\s+([A-Za-z0-9_$]+)$/);
      kinds.set(asMatch ? asMatch[1] : entry, kind);
    }
  }
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(function|class|const|let|var|interface|enum|type)\s+([A-Za-z0-9_$]+)/g
  )) {
    kinds.set(m[2], m[1] === "interface" || m[1] === "type" ? "type" : "value");
  }
  if (/export\s+default\s/.test(source)) kinds.set("default", "value");

  return [...kinds.entries()].map(([name, kind]) => `${name} (${kind})`).sort();
}

/** Names the barrel exports, without the kind suffix. */
function barrelNames(): Set<string> {
  return new Set(
    exportedNames("index.ts").map(entry => entry.replace(/ \(.*\)$/, ""))
  );
}

/**
 * Names carried by each release tag in the barrel. Every export clause is
 * tagged with exactly one tag, so the tag preceding a clause applies to every
 * name in it. A group heading may sit between the tag and the clause.
 */
function taggedPerSource(): { public: Set<string>; experimental: Set<string> } {
  const source = readFileSync(path.join(SRC, "index.ts"), "utf8");
  const tagged = { public: new Set<string>(), experimental: new Set<string>() };

  for (const m of source.matchAll(
    // The doc capture must not run past its own `*/`, or the module header —
    // which mentions both tags in prose — merges into the next clause's tag and
    // makes it look ambiguous.
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*(?:\/\/[^\n]*\n\s*)*export(?:\s+type)?\s*\{([^}]*)\}/g
  )) {
    const doc = m[1];
    const isPublic = /@public/.test(doc);
    const isExperimental = /@experimental/.test(doc);
    // A clause carrying both tags is ambiguous; leave it in neither bucket so
    // the coverage check below reports it rather than silently picking one.
    if (isPublic === isExperimental) continue;
    const bucket = isPublic ? tagged.public : tagged.experimental;
    for (const raw of m[2].split(",")) {
      const entry = raw.trim().replace(/^type\s+/, "");
      if (!entry) continue;
      const asMatch = entry.match(/\bas\s+([A-Za-z0-9_$]+)$/);
      bucket.add(asMatch ? asMatch[1] : entry);
    }
  }
  return tagged;
}

/** Backwards-compatible view for the ledger comparison below. */
function publicPerSource(): Set<string> {
  return taggedPerSource().public;
}

const ledger = readFileSync(path.join(PKG_ROOT, "STABILITY.md"), "utf8");
const packageJson = JSON.parse(
  readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")
) as { exports: Record<string, unknown> };

/** Everything backticked in the ledger's stable table, identifiers and files. */
function documentedPublic(): { names: string[]; files: string[] } {
  const start = ledger.indexOf("## Stable surface");
  const end = ledger.indexOf("## Experimental surface");
  // Fail closed: a renamed heading must break the check, not silently skip it.
  expect(
    start,
    "STABILITY.md is missing the '## Stable surface' heading"
  ).toBeGreaterThan(-1);
  expect(
    end,
    "STABILITY.md is missing the '## Experimental surface' heading"
  ).toBeGreaterThan(start);

  const section = ledger.slice(start, end);
  const ticked = [
    ...new Set([...section.matchAll(/`([A-Za-z][\w./-]*)`/g)].map(m => m[1])),
  ];
  return {
    // Lowercase identifiers count too — `toast` is a public runtime export.
    names: ticked.filter(t => /^[A-Za-z][A-Za-z0-9]*$/.test(t)),
    files: ticked.filter(t => t.endsWith(".css")),
  };
}

describe("ui public export surface", () => {
  it("has a source barrel for every published entry point", () => {
    // The one guard whose list cannot be derived, tied to the same source of truth by counting.
    // Without this, publishing a subpath and forgetting to add its source here leaves its export
    // names and value-versus-type kinds outside the snapshot, and every assertion stays green.
    expect(
      ENTRY_POINTS.length,
      `package.json publishes ${publishedEntries().length} JavaScript entry points and ` +
        `ENTRY_POINTS lists ${ENTRY_POINTS.length}. Add the new one's SOURCE barrel here.`
    ).toBe(publishedEntries().length);
  });

  it.each(ENTRY_POINTS)("%s surface is unchanged", file => {
    expect(exportedNames(file)).toMatchSnapshot();
  });

  // The name/kind extractor cannot see through `export *` re-exports, so a star
  // export would add names to the public surface that the snapshots never
  // record. Fail loudly if one is introduced, so the guard stays complete.
  it.each(ENTRY_POINTS)("%s uses only named exports (no `export *`)", file => {
    expect(sourceOf(file)).not.toMatch(/export\s+\*/);
  });
});

describe("ui STABILITY.md ledger", () => {
  it("promises no export the barrel does not ship", () => {
    const shipped = barrelNames();
    const missing = documentedPublic().names.filter(n => !shipped.has(n));

    expect(
      missing,
      `Listed as @public but not exported: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("promises no stylesheet the package does not export", () => {
    const exported = new Set(Object.keys(packageJson.exports));
    const missing = documentedPublic().files.filter(
      file => !exported.has(`./${file}`)
    );

    expect(
      missing,
      `Listed as @public but absent from the exports map: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("matches the @public tags in the barrel, in both directions", () => {
    const documented = new Set(documentedPublic().names);
    const tagged = publicPerSource();

    const taggedNotDocumented = [...tagged].filter(n => !documented.has(n));
    const documentedNotTagged = [...documented].filter(n => !tagged.has(n));

    expect(
      taggedNotDocumented,
      `Tagged @public in index.ts but absent from STABILITY.md: ` +
        `${taggedNotDocumented.join(", ")}`
    ).toEqual([]);
    expect(
      documentedNotTagged,
      `Listed @public in STABILITY.md but not tagged @public in index.ts: ` +
        `${documentedNotTagged.join(", ")}`
    ).toEqual([]);
  });

  it("gives every barrel export exactly one release tag", () => {
    const tagged = taggedPerSource();
    const shipped = [...barrelNames()];

    // An untagged export carries no guarantee either way, so a consumer cannot
    // tell whether it is safe to depend on; a doubly tagged one claims both.
    const unclassified = shipped.filter(
      name => !tagged.public.has(name) && !tagged.experimental.has(name)
    );
    const doubled = shipped.filter(
      name => tagged.public.has(name) && tagged.experimental.has(name)
    );

    expect(
      unclassified,
      `Exported from index.ts with no @public/@experimental tag: ` +
        `${unclassified.join(", ")}`
    ).toEqual([]);
    expect(
      doubled,
      `Tagged both @public and @experimental: ${doubled.join(", ")}`
    ).toEqual([]);
  });

  it("names a real surface, so the checks cannot pass vacuously", () => {
    expect(documentedPublic().names).toContain("toast");
    expect(documentedPublic().names.length).toBeGreaterThan(20);
    expect(publicPerSource().size).toBeGreaterThan(20);
  });
});

/**
 * The barrel's tags are a ledger; the tags on the declarations are what ships.
 *
 * They are the same fact written twice, which is only safe if something forces
 * them to agree. The barrel's tags reached no consumer at all until the
 * declarations carried them too: the DTS bundler flattens every re-export into
 * one `export { … }` clause and drops the doc comment that sat on the export
 * statement, so `@experimental` was visible in the source and absent from the
 * published `.d.ts` that editors and API tooling actually read.
 *
 * Reads the BUILT declarations, so `turbo.json` makes this package's `test`
 * task depend on its own `build`. It fails rather than skipping when they are
 * missing: a guard that quietly does nothing on a clean checkout is the same
 * as no guard, and this one exists precisely because something was silently
 * absent from an artifact.
 */
describe("ui release tags reach the published types", () => {
  // Vitest initialises a global setup once per project, so a watch rerun after
  // an edit would otherwise read declarations built before it. Regenerating
  // here — where it is re-evaluated every run — means the assertions below
  // always describe the current source rather than merely detecting that they
  // do not.
  // The ONLY place the declarations are built. A global setup ran once per
  // project and this hook ran per suite, so both together built twice per run
  // for no gain; this one covers the watch case a global setup cannot, because
  // it is re-evaluated on every rerun.
  //
  // A generous timeout because it BUILDS. The build is unconditional rather
  // than guarded by a staleness computation — see `ensure-declarations` for why
  // that computation was removed — and two tsup invocations do not fit in
  // Vitest's ten-second hook default. Allowing the time the operation takes is
  // the honest fix, not making the operation guess less carefully.
  // The directory the guard built for itself. Read from what the build
  // returned rather than assuming `dist`: the build stays out of `dist`
  // because other packages import this one through it while these tests run.
  let builtDir = "";
  beforeAll(() => {
    builtDir = ensureDeclarations();
  }, 120_000);

  /** Symbols re-exported from a dependency, whose declarations are not ours. */
  const FOREIGN = new Set(["toast", "ToasterProps"]);

  /** Each declaration's name, mapped to the release tag written above it. */
  function taggedPerDeclaration(built: string): Map<string, string> {
    const byName = new Map<string, string>();
    for (const m of built.matchAll(
      // A doc block, the tag inside it, then the declaration it belongs to.
      // Anchored on `/**` so the capture cannot start mid-comment and pick up
      // a tag belonging to something further up the file.
      /\/\*\*(?:(?!\*\/)[\s\S])*?@(public|experimental)(?:(?!\*\/)[\s\S])*\*\/\s*(?:declare\s+)?(?:const|function|interface|type|class)\s+([A-Za-z0-9_$]+)/g
    )) {
      byName.set(m[2], m[1]);
    }
    return byName;
  }

  /** Every published entry point, as `package.json` exports names them. */
  const DIST_ENTRIES = DECLARATION_ENTRIES;

  it("has built declarations to check", () => {
    // `ensureDeclarations` throws on a missing entry, so this asserts the
    // guard's own precondition rather than the state of a checkout: a guard
    // that quietly checks nothing is indistinguishable from a passing one.
    for (const entry of DIST_ENTRIES) {
      expect(
        existsSync(path.join(builtDir, entry)),
        `${entry} was not produced by the declaration build.`
      ).toBe(true);
    }
  });

  // BOTH barrels, because `package.json` resolves `require` to the `.cts` one.
  // Requiring only that the CommonJS barrel contain SOME tag let every symbol
  // but one lose or change its tag while this stayed green, so `require`
  // consumers could be served stability metadata nothing had compared.
  it.each(["index.d.ts", "index.d.cts"])(
    "carries every barrel tag through to dist/%s, with the same tag",
    entry => {
      const built = readFileSync(path.join(builtDir, entry), "utf8");
      const declared = taggedPerDeclaration(built);
      const tagged = taggedPerSource();

      const missing: string[] = [];
      const mismatched: string[] = [];
      for (const [kind, names] of [
        ["public", tagged.public],
        ["experimental", tagged.experimental],
      ] as const) {
        for (const name of names) {
          if (FOREIGN.has(name)) continue;
          const actual = declared.get(name);
          if (actual === undefined) {
            missing.push(name);
            // The tag kind is compared as well as its presence. Checking only
            // that SOME tag reached the declaration let a symbol ship
            // `@experimental` while the ledger promised `@public`, which is a
            // worse failure than no tag at all: it advertises a guarantee
            // nobody agreed to.
          } else if (actual !== kind) {
            mismatched.push(`${name}: barrel @${kind}, declaration @${actual}`);
          }
        }
      }

      expect(
        missing.sort(),
        `Tagged in index.ts but the tag does not reach dist/${entry}. The ` +
          "bundler keeps a doc comment attached to a DECLARATION and drops " +
          "one attached to an export statement, so the tag has to live on " +
          `the declaration: ${missing.join(", ")}`
      ).toEqual([]);
      expect(
        mismatched.sort(),
        `dist/${entry}: the published tag contradicts the ledger: ` +
          mismatched.join("; ")
      ).toEqual([]);
    }
  );

  it("gives a prop type the same tag as its component", () => {
    // STABILITY.md states this as a guarantee, and it is not a convention
    // anyone has to remember: a stable component whose props type is
    // experimental cannot be wrapped or forwarded to stably, so the weaker tag
    // silently withdraws what the component promises. It had drifted on twenty
    // of them, all in that direction.
    const tagged = taggedPerSource();
    const kindOf = (name: string): string | undefined =>
      tagged.public.has(name)
        ? "public"
        : tagged.experimental.has(name)
          ? "experimental"
          : undefined;

    const mismatched: string[] = [];
    for (const name of [...tagged.public, ...tagged.experimental]) {
      if (!name.endsWith("Props")) continue;
      const component = name.slice(0, -"Props".length);
      const componentKind = kindOf(component);
      // Only checked where the component is exported too; a props type for
      // something not on the surface has no component tag to agree with.
      if (componentKind === undefined) continue;
      const propKind = kindOf(name);
      if (propKind !== componentKind) {
        mismatched.push(
          `${name} @${propKind} but ${component} @${componentKind}`
        );
      }
    }
    expect(
      mismatched.sort(),
      "STABILITY.md: prop types carry the same guarantee as the component they " +
        `belong to.\n${mismatched.join("\n")}`
    ).toEqual([]);
  });

  it("tags every published entry point, not only the barrel", () => {
    // `cn` and `uiPreset` ship from their own subpaths and STABILITY.md
    // classifies them, so a consumer importing `@nextlyhq/ui/utils` should see
    // the same stability metadata as one importing the root. A guard that reads
    // only `index.d.ts` reports success while those subpaths carry none.
    for (const entry of DIST_ENTRIES) {
      const built = readFileSync(path.join(builtDir, entry), "utf8");
      expect(
        /@(?:public|experimental)/.test(built),
        `dist/${entry} carries no release tag; its declarations need one on ` +
          "the declaration itself, not on an export statement."
      ).toBe(true);
    }
  });

  it("is not passing vacuously", () => {
    const built = readFileSync(path.join(builtDir, "index.d.ts"), "utf8");
    const declared = taggedPerDeclaration(built);
    expect(
      [...declared.values()].filter(t => t === "public").length
    ).toBeGreaterThan(20);
    expect(
      [...declared.values()].filter(t => t === "experimental").length
    ).toBeGreaterThan(50);
  });
});

describe("ui release tags do not shadow the documentation", () => {
  /**
   * A release tag written as its own doc block SILENTLY DELETES the
   * description. TypeScript associates only the LAST leading doc block with a
   * declaration, so `/** description *\/` followed by `/** @experimental *\/`
   * yields a symbol whose tag is right and whose documentation is empty --
   * editor hovers and API tooling lose exactly what the tag was added
   * alongside. The tag belongs INSIDE the existing block.
   *
   * Parsed rather than pattern-matched: an intervening `//` comment separates
   * the two blocks on some declarations, and a regex written against the
   * adjacent case walks straight past those.
   */
  function shadowed(file: string): string[] {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    for (const stmt of sf.statements) {
      const blocks = (
        ts.getLeadingCommentRanges(text, stmt.getFullStart()) ?? []
      )
        .filter(r => text.slice(r.pos, r.pos + 3) === "/**")
        .map(r => text.slice(r.pos, r.end));
      if (blocks.length < 2) continue;

      // Only the last block reaches the symbol, so the defect is a last block
      // that is nothing BUT tags while an earlier one carries prose. A module
      // header sitting above the first statement also produces two blocks, and
      // is not this: there the last block is the real documentation.
      const prose = (b: string) =>
        b
          .replace(/^\/\*\*|\*\/$/g, "")
          .replace(/^\s*\*\s?/gm, "")
          .replace(/@\w+/g, "")
          .trim();
      if (prose(blocks[blocks.length - 1]!) !== "") continue;
      if (!blocks.slice(0, -1).some(b => prose(b) !== "")) continue;

      const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
      found.push(`${path.relative(SRC, file)}:${line}`);
    }
    return found;
  }

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/^(__tests__|__snapshots__)$/.test(entry.name))
          out.push(...sourceFiles(full));
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        out.push(full);
    }
    return out;
  }

  it("keeps every tag inside the block that documents the symbol", () => {
    const offenders = sourceFiles(SRC).flatMap(shadowed);
    expect(
      offenders,
      "these declarations carry a release tag in a doc block of its own, so " +
        "their description never reaches the symbol. Move the tag into the " +
        "existing block as a trailing `@experimental` / `@public` line."
    ).toEqual([]);
  });

  it("is not passing vacuously", () => {
    // The detector must actually fire, or an empty result above would mean
    // "nothing was parsed" just as readily as "nothing is wrong".
    const probe = path.join(SRC, "__tests__", "shadowed-tag-probe.fixture.ts");
    expect(shadowed(probe)).toHaveLength(1);
  });
});
