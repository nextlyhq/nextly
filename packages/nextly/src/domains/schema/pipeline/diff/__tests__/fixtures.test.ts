// F8 PR 7: regression fixtures for the diff engine.
//
// Loads each JSON fixture in __fixtures__/, runs `diffSnapshots(live,
// desired)` on the captured input pair, and asserts the produced
// Operation[] matches the expected shape (op types + column names).
//
// Why JSON fixtures rather than inline TS test cases: stable on-disk
// snapshots make it obvious to a future contributor when the diff
// engine output changes — the diff vs the fixture file shows up as a
// small JSON edit instead of a buried test-case rewrite. F8 originally
// planned drizzle-kit-output fixtures (cancelled in F4 Option E pivot
// when drizzle-kit's TTY prompt issue made capturing impossible);
// these replace that suite, capturing OUR diff output instead.
//
// Adding a new scenario: drop a JSON file in __fixtures__/, no test
// code changes needed — the loader at the bottom picks it up.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import type {
  AddColumnOp,
  ChangeColumnTypeOp,
  DropColumnOp,
  NextlySchemaSnapshot,
  Operation,
} from "../types";

interface DiffFixture {
  name: string;
  description?: string;
  dialect: SupportedDialect;
  live: NextlySchemaSnapshot;
  desired: NextlySchemaSnapshot;
  expectedOpTypes: Operation["type"][];
  expectedAddColumnNames?: string[];
  expectedDropColumnNames?: string[];
  expectedChangedColumnNames?: string[];
}

const FIXTURES_DIR = join(__dirname, "__fixtures__");

function loadFixtures(): DiffFixture[] {
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith(".json"));
  return files.map(file => {
    const raw = readFileSync(join(FIXTURES_DIR, file), "utf8");
    return JSON.parse(raw) as DiffFixture;
  });
}

describe("diff engine fixtures", () => {
  const fixtures = loadFixtures();

  it("loads at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures.map(f => [f.name, f] as const))(
    "%s",
    (_name, fixture) => {
      it("produces the expected operation types", () => {
        const ops = diffSnapshots(fixture.live, fixture.desired);
        // Ops can land in any order; sort both sides by `type` to
        // make assertion order-stable.
        const actualTypes = ops.map(o => o.type).sort();
        const expectedTypes = [...fixture.expectedOpTypes].sort();
        expect(actualTypes).toEqual(expectedTypes);
      });

      if (fixture.expectedAddColumnNames) {
        it("emits add_column ops for the expected columns", () => {
          const ops = diffSnapshots(fixture.live, fixture.desired);
          const addNames = ops
            .filter((o): o is AddColumnOp => o.type === "add_column")
            .map(o => o.column.name)
            .sort();
          expect(addNames).toEqual([...fixture.expectedAddColumnNames!].sort());
        });
      }

      if (fixture.expectedDropColumnNames) {
        it("emits drop_column ops for the expected columns", () => {
          const ops = diffSnapshots(fixture.live, fixture.desired);
          const dropNames = ops
            .filter((o): o is DropColumnOp => o.type === "drop_column")
            .map(o => o.columnName)
            .sort();
          expect(dropNames).toEqual(
            [...fixture.expectedDropColumnNames!].sort()
          );
        });
      }

      if (fixture.expectedChangedColumnNames) {
        it("emits change_column_type ops for the expected columns", () => {
          const ops = diffSnapshots(fixture.live, fixture.desired);
          const changedNames = ops
            .filter(
              (o): o is ChangeColumnTypeOp => o.type === "change_column_type"
            )
            .map(o => o.columnName)
            .sort();
          expect(changedNames).toEqual(
            [...fixture.expectedChangedColumnNames!].sort()
          );
        });
      }
    }
  );
});
