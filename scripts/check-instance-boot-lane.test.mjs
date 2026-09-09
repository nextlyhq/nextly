/**
 * What separates a boot from a mention of one.
 *
 * The check exists because the two lanes are told apart by filename, and it is
 * useful only if it can tell an import from prose: most files naming the helper
 * outside the integration suffix name it in a docblock, and a check that
 * reports those is one that gets turned off.
 */
import { describe, expect, it } from "vitest";

import {
  BOOT_BINDING,
  integrationName,
  INTEGRATION_SUFFIX,
  UNIT_LANE_SUFFIXES,
  classify,
  hasIntegrationLane,
  importsBootHelper,
  packageOf,
  testFiles,
} from "./check-instance-boot-lane.mjs";

/** A reader over an in-memory file set, so no case touches the disk. */
function reader(files) {
  return path => {
    if (!(path in files)) throw new Error(`no such file: ${path}`);
    return files[path];
  };
}

describe("telling a boot from a mention of one", () => {
  it("sees a plain named import", () => {
    expect(
      importsBootHelper(`import { createTestNextly } from "../test-nextly";`)
    ).toBe(true);
  });

  it("sees it beside other bindings, and under any specifier", () => {
    // The helper is imported under nine specifiers across the repository, so
    // the binding is what identifies it and the module never is.
    for (const from of [
      "nextly/testing",
      "@nextlyhq/plugin-sdk/testing",
      "../../../../plugins/test-nextly",
    ]) {
      expect(
        importsBootHelper(
          `import { type TestNextly, createTestNextly } from "${from}";`
        )
      ).toBe(true);
    }
  });

  it("sees it renamed, because a rename still boots", () => {
    expect(
      importsBootHelper(
        `import { createTestNextly as boot } from "../test-nextly";`
      )
    ).toBe(true);
  });

  it("does NOT see it in a line comment", () => {
    expect(
      importsBootHelper(`// createTestNextly clears this cache on every boot`)
    ).toBe(false);
  });

  it("does NOT see it in a docblock, which is how it actually appears", () => {
    // The shape that makes a text match unusable: of the files naming the
    // helper outside the integration suffix, this is what most of them are.
    expect(
      importsBootHelper(`/**
 * Unit tests with a spied entry service; the live \`createTestNextly\` path is
 * proven elsewhere.
 */
import { describe, it } from "vitest";`)
    ).toBe(false);
  });

  it("does NOT see it inside a string", () => {
    expect(
      importsBootHelper(`const helper = "createTestNextly";`)
    ).toBe(false);
  });

  it("does NOT see a type-only import, which boots nothing", () => {
    expect(
      importsBootHelper(`import type { createTestNextly } from "../x";`)
    ).toBe(false);
    expect(
      importsBootHelper(`import { type createTestNextly } from "../x";`)
    ).toBe(false);
  });

  it("does not confuse a different binding from the same module", () => {
    // The positive control for the negatives above: they would all pass on a
    // predicate that answered false to everything.
    expect(
      importsBootHelper(`import { createTestFixture } from "../test-nextly";`)
    ).toBe(false);
    expect(
      importsBootHelper(`import { createTestNextly } from "../test-nextly";`)
    ).toBe(true);
  });

  it("sees a boot reached through a namespace import", () => {
    // `import * as testing from "..."` names only `testing` in the clause, so
    // the property access is the fact that identifies the boot. Deciding it
    // from the import would need the specifier list this deliberately avoids.
    expect(
      importsBootHelper(`import * as testing from "nextly/testing";
const app = await testing.createTestNextly({});`)
    ).toBe(true);
  });

  it("does NOT see a local object that happens to expose the name", () => {
    // The false positive the receiver check exists to prevent. A fixture or a
    // mock exposing `createTestNextly` boots nothing, and demanding an
    // integration rename for it would be the check firing on a correct file.
    expect(
      importsBootHelper(`import { describe } from "vitest";
const fixture = { createTestNextly: () => ({}) };
const app = fixture.createTestNextly();`)
    ).toBe(false);
  });

  it("does NOT see a namespace it never imported", () => {
    expect(
      importsBootHelper(`import * as other from "./helpers";
const app = fixture.createTestNextly();`)
    ).toBe(false);
  });

  it("sees it through the namespace that WAS imported, beside one that was not", () => {
    // The positive control for the two negatives above: they would both pass on
    // a predicate that stopped recognising namespace boots entirely.
    expect(
      importsBootHelper(`import * as testing from "nextly/testing";
const decoy = { createTestNextly: () => ({}) };
const app = await testing.createTestNextly({});`)
    ).toBe(true);
  });

  it("does NOT see a property access spelled inside a comment", () => {
    // The control for the case above: it must still be the compiler deciding,
    // not a substring of the source.
    expect(
      importsBootHelper(`// call testing.createTestNextly() to boot one
import { describe } from "vitest";`)
    ).toBe(false);
  });

  it("reads a .tsx suite, which the unit lane also includes", () => {
    expect(
      importsBootHelper(
        `import { createTestNextly } from "../t";\nconst el = <div />;`,
        "widget.test.tsx"
      )
    ).toBe(true);
  });
});

describe("routing a boot to a lane", () => {
  const BOOT = `import { createTestNextly } from "../test-nextly";`;
  /* A package that can actually run the integration suffix it is given. */
  const LANE = {
    "packages/a/package.json": JSON.stringify({
      scripts: { "test:integration": "vitest run --config i.ts" },
    }),
  };

  it("accepts a boot named for the integration lane in a package that runs it", () => {
    const files = { ...LANE, [`packages/a/src/x${INTEGRATION_SUFFIX}`]: BOOT };
    const { misrouted, stranded, covered } = classify(
      [`packages/a/src/x${INTEGRATION_SUFFIX}`],
      reader(files)
    );

    expect(misrouted).toEqual([]);
    expect(stranded).toEqual([]);
    expect(covered).toHaveLength(1);
  });

  it("reports a correctly named boot whose package runs no integration lane", () => {
    // The worse of the two failures, and the one a filename cannot see: the
    // suite is not in a slower lane, it is in none, so it stops reporting and
    // every job stays green.
    const files = {
      "packages/a/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      [`packages/a/src/x${INTEGRATION_SUFFIX}`]: BOOT,
    };
    const { misrouted, stranded, covered } = classify(
      [`packages/a/src/x${INTEGRATION_SUFFIX}`],
      reader(files)
    );

    expect(stranded).toEqual([`packages/a/src/x${INTEGRATION_SUFFIX}`]);
    expect(covered).toEqual([]);
    expect(misrouted).toEqual([]);
  });

  it("reports a booting spec suite, which no integration config can ever collect", () => {
    // The unit configs take `*.{test,spec}.{ts,tsx}`; every integration config
    // takes `*.integration.test.ts` and nothing else. A booting `.spec.ts` is
    // therefore unroutable under its own name rather than merely slow.
    const files = { ...LANE, "packages/a/src/x.spec.ts": BOOT };
    const { misrouted } = classify(["packages/a/src/x.spec.ts"], reader(files));

    expect(misrouted).toEqual(["packages/a/src/x.spec.ts"]);
  });

  it("reports a boot named for the unit lane", () => {
    const files = { "packages/a/src/x.test.ts": BOOT };
    const { misrouted } = classify(Object.keys(files), reader(files));

    expect(misrouted).toEqual(["packages/a/src/x.test.ts"]);
  });

  it("leaves a unit suite that boots nothing alone", () => {
    const files = { "packages/a/src/x.test.ts": `import { it } from "vitest";` };
    const { misrouted, covered } = classify(Object.keys(files), reader(files));

    expect(misrouted).toEqual([]);
    expect(covered).toEqual([]);
  });

  it("returns the covered population, which is what makes a clean run mean something", () => {
    // `misrouted` being empty is the same answer whether every boot is routed
    // correctly or the parser stopped recognising boots at all. The caller
    // refuses the second, and can only tell them apart from this.
    const files = {
      ...LANE,
      [`packages/a/src/x${INTEGRATION_SUFFIX}`]: BOOT,
      "packages/b/src/y.test.ts": `import { it } from "vitest";`,
    };
    const { misrouted, covered } = classify(
      [`packages/a/src/x${INTEGRATION_SUFFIX}`, "packages/b/src/y.test.ts"],
      reader(files)
    );

    expect(misrouted).toEqual([]);
    expect(covered).toEqual([`packages/a/src/x${INTEGRATION_SUFFIX}`]);
  });

  it("skips a listed file the disk cannot read rather than throwing", () => {
    const files = { ...LANE, "packages/a/src/x.test.ts": BOOT };
    const { misrouted } = classify(
      ["packages/a/src/x.test.ts", "packages/a/src/gone.test.ts"],
      reader(files)
    );

    expect(misrouted).toEqual(["packages/a/src/x.test.ts"]);
  });
});

describe("whether a rename would land the suite anywhere", () => {
  it("is true for a package that declares the integration script", () => {
    const files = {
      "packages/a/package.json": JSON.stringify({
        scripts: { "test:integration": "vitest run --config x" },
      }),
    };

    expect(hasIntegrationLane("packages/a", reader(files))).toBe(true);
  });

  it("is false for a package that does not, so the advice can say so", () => {
    // Renaming into a lane a package does not have moves the suite out of the
    // unit run and into nothing, which is worse than the timeout it fixes.
    const files = {
      "packages/a/package.json": JSON.stringify({
        scripts: { test: "vitest run" },
      }),
    };

    expect(hasIntegrationLane("packages/a", reader(files))).toBe(false);
  });

  it("is false, rather than throwing, for an unreadable manifest", () => {
    expect(hasIntegrationLane("packages/gone", reader({}))).toBe(false);
  });
});

describe("the population it judges", () => {
  it("keeps every suffix the unit lane collects, and drops everything else", () => {
    // `spec` is in the population because the unit configs take it; a scan that
    // dropped it would call the repository clean while a boot sat in the unit
    // lane under a name no integration config can collect.
    const listed = [
      "packages/a/src/x.test.ts",
      "packages/a/src/y.test.tsx",
      "packages/a/src/s.spec.ts",
      "packages/a/src/s2.spec.tsx",
      `packages/a/src/z${INTEGRATION_SUFFIX}`,
      "packages/a/src/index.ts",
      "packages/a/package.json",
      "packages/a/README.md",
    ].join("\0");

    expect(testFiles(".", () => listed)).toEqual([
      "packages/a/src/x.test.ts",
      "packages/a/src/y.test.tsx",
      "packages/a/src/s.spec.ts",
      "packages/a/src/s2.spec.tsx",
      `packages/a/src/z${INTEGRATION_SUFFIX}`,
    ]);
  });

  it("collects the suffixes the unit configs name", () => {
    expect(UNIT_LANE_SUFFIXES).toEqual([
      ".test.ts",
      ".test.tsx",
      ".spec.ts",
      ".spec.tsx",
    ]);
  });

  it("renames every unit suffix to the one suffix an integration config takes", () => {
    // A `.spec.ts` renamed to a `.spec` form would still be collected by no
    // integration config, so the advice has to cross the suffix families.
    expect(integrationName("packages/a/src/x.test.ts")).toBe(
      `packages/a/src/x${INTEGRATION_SUFFIX}`
    );
    expect(integrationName("packages/a/src/x.spec.ts")).toBe(
      `packages/a/src/x${INTEGRATION_SUFFIX}`
    );
    expect(integrationName("packages/a/src/x.spec.tsx")).toBe(
      `packages/a/src/x${INTEGRATION_SUFFIX}`
    );
  });

  it("names the package a file belongs to", () => {
    expect(packageOf("packages/plugin-seo/src/a.test.ts")).toBe(
      "packages/plugin-seo"
    );
  });

  it("uses the binding the repository actually imports", () => {
    expect(BOOT_BINDING).toBe("createTestNextly");
  });
});
