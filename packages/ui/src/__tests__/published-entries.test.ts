/**
 * The export map is the enrolment list for three guards, so what it REFUSES is load-bearing.
 *
 * These run against fixtures rather than this package's own `package.json`. Every refusal below
 * describes a map the package does not have yet — a client subpath beside the root, a bare
 * JavaScript target, two subpaths sharing one artifact — and a check exercised only against the
 * real map would be asserting that today's map is acceptable, which is a different claim.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  clientBuildEntries,
  derivePublishedEntries,
  serverSafeBuildEntries,
  type DeclaredBarrel,
} from "../../scripts/published-entries.mjs";

/** The four conditions a JavaScript entry point has to name. */
function conditions(name: string): Record<string, Record<string, string>> {
  return {
    import: { types: `./dist/${name}.d.ts`, default: `./dist/${name}.mjs` },
    require: { types: `./dist/${name}.d.cts`, default: `./dist/${name}.cjs` },
  };
}

const barrel = (source: string, client: boolean): DeclaredBarrel => ({
  source,
  client,
});

describe("which side of the React boundary an entry point sits on", () => {
  it("reads the declaration rather than assuming anything but the root is server-safe", () => {
    // Derived from `subpath !== "."`, a client subpath added later was built by the server-safe
    // config — which adds no `"use client"` banner — while the directive guard demanded that same
    // artifact stay unmarked. Three guards pass over an entry point React cannot use.
    const entries = derivePublishedEntries(
      {
        ".": conditions("index"),
        "./charts": conditions("charts"),
        "./utils": conditions("utils"),
      },
      {
        ".": barrel("src/index.ts", true),
        "./charts": barrel("src/charts/index.ts", true),
        "./utils": barrel("src/lib/utils.ts", false),
      }
    );

    const serverSafe = entries
      .filter(entry => entry.serverSafe)
      .map(entry => entry.subpath);

    // The control is `./utils` in the same map: a declared server-safe subpath is still one, so
    // this is not passing by calling everything client code.
    expect(serverSafe).toEqual(["./utils"]);
  });
});

describe("which tsup config builds what", () => {
  it("builds every client entry, not only the first", () => {
    // Selecting one client entry left a second emitted by NEITHER config — the server-safe build
    // excludes all client entries — while the directive guard still required its banner, so the
    // build failed on a file nothing had been asked to produce.
    const entries = derivePublishedEntries(
      {
        ".": conditions("index"),
        "./charts": conditions("charts"),
        "./utils": conditions("utils"),
      },
      {
        ".": barrel("src/index.ts", true),
        "./charts": barrel("src/charts/index.ts", true),
        "./utils": barrel("src/lib/utils.ts", false),
      }
    );

    expect(clientBuildEntries(entries)).toEqual({
      index: "src/index.ts",
      charts: "src/charts/index.ts",
    });
    // The control: the two builds partition the entries, so nothing is emitted twice either.
    expect(serverSafeBuildEntries(entries)).toEqual({
      utils: "src/lib/utils.ts",
    });
  });

  it("refuses an export map with no client entry at all", () => {
    const entries = derivePublishedEntries(
      { "./utils": conditions("utils") },
      { "./utils": barrel("src/lib/utils.ts", false) }
    );
    expect(() => clientBuildEntries(entries)).toThrow(
      /No client entry point was found/
    );
  });
});

describe("two subpaths that resolve to one artifact", () => {
  it("refuses them when they are built from different barrels", () => {
    // The build entries are keyed by artifact name, so the second overwrites the first and both
    // subpaths ship the later barrel's API — while the surface suite snapshots the two declared
    // sources separately and the file guards inspect the one shared output twice.
    expect(() =>
      derivePublishedEntries(
        { "./a": conditions("shared"), "./b": conditions("shared") },
        {
          "./a": barrel("src/a.ts", false),
          "./b": barrel("src/b.ts", false),
        }
      )
    ).toThrow(/both resolve to the artifact "shared"/);
  });

  it("allows them when they are aliases of one barrel", () => {
    // The control: sharing an artifact is only a problem when the sources disagree. Refusing it
    // outright would ban a deliberate alias.
    expect(() =>
      derivePublishedEntries(
        { "./a": conditions("shared"), "./b": conditions("shared") },
        {
          "./a": barrel("src/shared.ts", false),
          "./b": barrel("src/shared.ts", false),
        }
      )
    ).not.toThrow();
  });
});

describe("targets the guards cannot read", () => {
  it("refuses a JavaScript subpath published as a bare string", () => {
    expect(() =>
      derivePublishedEntries(
        { ".": conditions("index"), "./motion": "./dist/motion.mjs" },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/maps directly to "\.\/dist\/motion\.mjs"/);
  });

  it("refuses one with no extension at all", () => {
    // The reason the test is an allow-list of asset extensions and not a list of JavaScript ones:
    // a deny-list passes this, and it is still JavaScript no condition names.
    expect(() =>
      derivePublishedEntries(
        { ".": conditions("index"), "./motion": "./dist/motion" },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/maps directly to "\.\/dist\/motion"/);
  });

  it("still passes over a stylesheet", () => {
    // The control: stylesheets are published as bare strings too, and none of the guards has
    // anything to say about one.
    const entries = derivePublishedEntries(
      { ".": conditions("index"), "./theme.css": "./dist/theme.css" },
      { ".": barrel("src/index.ts", true) }
    );
    expect(entries.map(entry => entry.subpath)).toEqual(["."]);
  });

  it("refuses an entry missing one of its four conditions", () => {
    const partial = conditions("index");
    delete partial.require;
    expect(() =>
      derivePublishedEntries(
        { ".": partial },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/has no requireTypes target/);
  });
});

describe("export conditions the guards do not follow", () => {
  it("refuses a runtime condition it cannot traverse", () => {
    // A resolver picks the FIRST condition it matches, so `react-server` would be selected ahead
    // of `import`/`require` in that environment — and the file those consumers receive would have
    // had neither its surface nor its client directive checked.
    const target = {
      "react-server": { types: "./dist/rsc.d.ts", default: "./dist/rsc.mjs" },
      ...conditions("index"),
    };
    expect(() =>
      derivePublishedEntries(
        { ".": target },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/has a "react-server" condition/);
  });

  it("refuses an unfollowed target inside a condition it does follow", () => {
    const target = conditions("index");
    target.import = { ...target.import, browser: "./dist/index.browser.mjs" };
    expect(() =>
      derivePublishedEntries(
        { ".": target },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/has a "import.browser" target/);
  });

  it("still accepts the four it does follow", () => {
    // The control: the refusal is scoped to keys the guards cannot read, not to conditions in
    // general — the ordinary dual-format entry must keep working.
    expect(
      derivePublishedEntries(
        { ".": conditions("index") },
        { ".": barrel("src/index.ts", true) }
      )
    ).toHaveLength(1);
  });
});

describe("the barrel declaration and the export map", () => {
  it("refuses a published subpath with no declared barrel", () => {
    expect(() =>
      derivePublishedEntries({ ".": conditions("index") }, {})
    ).toThrow(/has no source barrel/);
  });

  it("refuses a declared barrel the export map does not publish", () => {
    // Consumers derive their lists from the published entries, so a stale key is dropped before
    // any guard sees it: the retarget it describes would go unchecked.
    expect(() =>
      derivePublishedEntries(
        { ".": conditions("index") },
        {
          ".": barrel("src/index.ts", true),
          "./motion": barrel("src/lib/motion.ts", false),
        }
      )
    ).toThrow(/SOURCES names \.\/motion/);
  });

  it("refuses an export map with no JavaScript entry points at all", () => {
    expect(() =>
      derivePublishedEntries({ "./theme.css": "./dist/theme.css" }, {})
    ).toThrow(/passing vacuously/);
  });
});

describe("the hand-written declaration beside the module", () => {
  // A `.d.mts` maintained alongside a `.mjs` is a second list of the same facts, which is the
  // shape this module exists to remove everywhere else. Nothing typechecks these tests today, so
  // a declaration naming a function that no longer exists stayed green through a rename.
  const scripts = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "scripts"
  );
  const names = (file: string): string[] =>
    [
      ...readFileSync(path.join(scripts, file), "utf8").matchAll(
        /^export function (\w+)/gm
      ),
    ]
      .map(match => match[1]!)
      .sort();

  it("declares exactly the functions the module exports", () => {
    const runtime = names("published-entries.mjs");
    expect(
      runtime.length,
      "no exported functions were found to compare"
    ).toBeGreaterThan(0);
    expect(names("published-entries.d.mts")).toEqual(runtime);
  });
});
