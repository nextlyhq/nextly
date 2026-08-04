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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(SRC, "..");

/** The entry points named in the package's `exports` map. */
const ENTRY_POINTS = ["index.ts", "lib/utils.ts", "tailwind-preset.ts"];

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
  /** Symbols re-exported from a dependency, whose declarations are not ours. */
  const FOREIGN = new Set(["toast", "ToasterProps"]);

  const distTypes = path.join(PKG_ROOT, "dist", "index.d.ts");

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

  it("has built declarations to check", () => {
    expect(
      existsSync(distTypes),
      `${distTypes} is missing. This guard reads the built declarations, so ` +
        "run `pnpm --filter @nextlyhq/ui build` first. It fails rather than " +
        "skipping, because a guard that does nothing on a clean checkout is " +
        "indistinguishable from a passing one."
    ).toBe(true);
  });

  it("carries every barrel tag through to dist/index.d.ts, with the same tag", () => {
    const built = readFileSync(distTypes, "utf8");
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
      "Tagged in index.ts but the tag does not reach dist/index.d.ts. The " +
        "bundler keeps a doc comment attached to a DECLARATION and drops one " +
        "attached to an export statement, so the tag has to live on the " +
        `declaration: ${missing.join(", ")}`
    ).toEqual([]);
    expect(
      mismatched.sort(),
      `The published tag contradicts the ledger: ${mismatched.join("; ")}`
    ).toEqual([]);
  });

  it("is not passing vacuously", () => {
    const built = readFileSync(distTypes, "utf8");
    const declared = taggedPerDeclaration(built);
    expect(
      [...declared.values()].filter(t => t === "public").length
    ).toBeGreaterThan(20);
    expect(
      [...declared.values()].filter(t => t === "experimental").length
    ).toBeGreaterThan(50);
  });
});
