// What each package's tsdown configuration keeps out of its bundles, asked of
// the configurations themselves.
//
// tsdown hands `deps.neverBundle` and `deps.dts.neverBundle` to rolldown as
// `external`, and rolldown asks it twice for an import: with the specifier as
// written, and again with the file it resolved to. A predicate that recognises
// a package name by its first character accepts a Windows path, whose drive
// letter is one, and marks the package's own source external. For the
// declarations that binds each import to the JavaScript module, where no type
// is exported, and the build fails on Windows while every Linux runner, whose
// paths start with `/`, passes. Each predicate is asked here about the
// package's own entry file in each platform's spelling, so the answer does not
// depend on which operating system runs the suite.
import { readdirSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

/** Every tsdown configuration file in a published or private package. */
const CONFIG_FILES = readdirSync(join(root, "packages"), {
  withFileTypes: true,
})
  .filter(entry => entry.isDirectory())
  .flatMap(entry =>
    readdirSync(join(root, "packages", entry.name))
      .filter(file => /^tsdown(\..+)?\.config\.ts$/.test(file))
      .map(file => ({ pkg: entry.name, file }))
  );

/** A file of the package's own source, as each platform spells its resolved id. */
function ownSourceIds(pkg, file) {
  return [
    posix.join("/home/runner/work/nextly/nextly/packages", pkg, "src", file),
    win32.join("D:\\a\\nextly\\nextly\\packages", pkg, "src", file),
    win32
      .join("D:\\a\\nextly\\nextly\\packages", pkg, "src", file)
      .replaceAll("\\", "/"),
  ];
}

/** Each function-form predicate a configuration hands rolldown, with where it is. */
async function predicatesIn({ pkg, file }) {
  const loaded = (
    await import(pathToFileURL(join(root, "packages", pkg, file)).href)
  ).default;
  const configs = Array.isArray(loaded) ? loaded : [loaded];
  return configs.flatMap((config, index) =>
    [
      {
        kind: "js",
        predicate: config.deps?.neverBundle,
        importerFile: "index.ts",
      },
      {
        kind: "dts",
        predicate: config.deps?.dts?.neverBundle,
        importerFile: "index.d.ts",
      },
    ]
      .filter(entry => typeof entry.predicate === "function")
      .map(entry => ({
        ...entry,
        where: `packages/${pkg}/${file}[${index}] ${entry.kind}`,
      }))
  );
}

/** The predicates a configuration file was asked through, and the own-source ids any kept out. */
async function ownSourceKeptOut(config) {
  const predicates = await predicatesIn(config);
  return {
    asked: predicates.map(({ where }) => where),
    external: predicates.flatMap(({ predicate, importerFile, where }) => {
      const [importer] = ownSourceIds(config.pkg, importerFile);
      return ownSourceIds(config.pkg, "layout/RootLayout.tsx")
        .filter(id => predicate(id, importer, true))
        .map(id => `${where}: ${id}`);
    }),
  };
}

describe("what a tsdown configuration keeps out of its bundles", () => {
  it("reads every package's configuration", () => {
    // A glob that stopped matching would leave the test below asking nothing.
    expect(CONFIG_FILES.map(({ pkg, file }) => `${pkg}/${file}`)).toContain(
      "admin/tsdown.config.ts"
    );
  });

  it("never keeps a package's own source file out, however the platform spells its path", async () => {
    const results = await Promise.all(CONFIG_FILES.map(ownSourceKeptOut));
    const asked = results.flatMap(result => result.asked);
    const external = results.flatMap(result => result.external);
    // The predicate the Windows failure came from is among those asked.
    expect(asked).toContain("packages/admin/tsdown.config.ts[0] dts");
    expect(
      external,
      "A neverBundle predicate must be false for a file path on every platform: test the " +
        "package name exactly, or reject an absolute path (path.win32.isAbsolute covers both)."
    ).toEqual([]);
  }, 60_000);
});
