/**
 * The printed inventory of transaction escapes: what the accepted list is
 * built from, so its counts, grouping and unknown share must be exact.
 */
import { describe, expect, it } from "vitest";

import { KNOWN_ESCAPES } from "./transaction-escape-baseline";
import {
  describeInventory,
  type InventoryLine,
  staleKnownEscapes,
} from "./transaction-escapes-inventory";
import { type KnownEscape, UNKNOWN_SITE } from "./transaction-escapes";

describe("describeInventory", () => {
  it("groups by dialect then site, counts each, and lists the test files that reached it", () => {
    const text = describeInventory([
      {
        dialect: "postgresql",
        key: "packages/a.ts#A.run",
        accepted: false,
        testFile: "/repo/packages/nextly/src/x.integration.test.ts",
      },
      {
        dialect: "postgresql",
        key: "packages/a.ts#A.run",
        accepted: false,
        testFile: "/repo/packages/nextly/src/y.integration.test.ts",
      },
      {
        dialect: "mysql",
        key: "packages/b.ts#B.go",
        accepted: true,
        testFile: "/repo/packages/nextly/src/x.integration.test.ts",
      },
    ]);

    expect(text.split("\n")).toEqual([
      "[transaction escapes] inventory: 3 report(s), 0 (0%) with no call site",
      "mysql:",
      "  1x packages/b.ts#B.go (accepted)",
      "      packages/nextly/src/x.integration.test.ts",
      "postgresql:",
      "  2x packages/a.ts#A.run",
      "      packages/nextly/src/x.integration.test.ts",
      "      packages/nextly/src/y.integration.test.ts",
    ]);
  });

  it("reports the share of reports that named no call site", () => {
    const text = describeInventory([
      { dialect: "mysql", key: UNKNOWN_SITE, accepted: false },
      { dialect: "mysql", key: "packages/b.ts#B.go", accepted: false },
      { dialect: "mysql", key: "packages/b.ts#B.go", accepted: false },
    ]);

    expect(text.split("\n")[0]).toBe(
      "[transaction escapes] inventory: 3 report(s), 1 (33.3%) with no call site"
    );
  });
});

describe("staleKnownEscapes", () => {
  const entry: KnownEscape = {
    dialect: "postgresql",
    key: "packages/a.ts#A.run",
    witness: "packages/nextly/src/w.integration.test.ts",
    reason: "known: test",
  };
  const reached: InventoryLine = {
    dialect: "postgresql",
    key: "packages/a.ts#A.run",
    accepted: true,
    testFile: "/repo/packages/nextly/src/w.integration.test.ts",
  };
  const ran = new Set(["packages/nextly/src/w.integration.test.ts"]);
  const postgres = new Set(["postgresql"]);

  it("keeps an entry its witness still reaches", () => {
    expect(staleKnownEscapes([entry], [reached], ran, postgres)).toEqual([]);
  });

  it("reports an entry whose witness ran and no longer reaches it, so the list only shrinks", () => {
    expect(staleKnownEscapes([entry], [], ran, postgres)).toEqual([entry]);
  });

  it("does not count another file reaching the entry as its witness reaching it", () => {
    const elsewhere = {
      ...reached,
      testFile: "/repo/packages/nextly/src/other.integration.test.ts",
    };
    expect(staleKnownEscapes([entry], [elsewhere], ran, postgres)).toEqual([
      entry,
    ]);
  });

  it("judges no entry without a witness, whose escape does not happen on every run", () => {
    const unwitnessed = { ...entry, witness: null };
    expect(staleKnownEscapes([unwitnessed], [], ran, postgres)).toEqual([]);
  });

  it("judges nothing when the witness did not run, or ran without the entry's dialect", () => {
    expect(staleKnownEscapes([entry], [], new Set(), postgres)).toEqual([]);
    expect(staleKnownEscapes([entry], [], ran, new Set(["mysql"]))).toEqual([]);
  });
});

describe("the known escape baseline", () => {
  it("lists each dialect and key once", () => {
    const keys = KNOWN_ESCAPES.map(e => `${e.dialect} ${e.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a witness test file and a reason for every entry, or says why it has none", () => {
    for (const entry of KNOWN_ESCAPES) {
      if (entry.witness === null) {
        // Only an escape that does not happen on every run may go unwitnessed.
        expect(entry.reason).toMatch(/^known, timing-dependent: /);
        continue;
      }
      expect(entry.witness).toMatch(
        /^packages\/[\w./-]+\.integration\.test\.ts$/
      );
      expect(entry.reason).toMatch(/^known: /);
    }
  });
});
