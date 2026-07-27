/**
 * A `serial` column's sequence default belongs to the type: PostgreSQL reports
 * `nextval('<table>_id_seq'::regclass)` while the desired side declares no
 * default at all. Read literally that is a default being dropped on every
 * reconcile, so it is suppressed — but only while the column is still declared
 * serial. A sequence default anywhere else was set deliberately, and removing
 * it is a real change.
 */
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import type { NextlySchemaSnapshot } from "../types";

const NEXTVAL = "nextval('t_id_seq'::regclass)";

function snapshot(
  type: string,
  columnDefault: string | undefined
): NextlySchemaSnapshot {
  return {
    tables: [
      {
        name: "t",
        columns: [
          { name: "id", type, nullable: false, default: columnDefault },
        ],
        indexes: [],
      },
    ],
  } as unknown as NextlySchemaSnapshot;
}

const defaultOps = (
  live: NextlySchemaSnapshot,
  desired: NextlySchemaSnapshot
): unknown[] =>
  diffSnapshots(live, desired).filter(
    op => op.type === "change_column_default"
  );

describe("serial sequence defaults", () => {
  it("does not report a change while the column is still serial", () => {
    // The live side materialises what `serial` implies; the desired side
    // never spells it.
    expect(
      defaultOps(snapshot("int4", NEXTVAL), snapshot("serial", undefined))
    ).toHaveLength(0);
  });

  it("covers bigserial and smallserial", () => {
    for (const [live, desired] of [
      ["int8", "bigserial"],
      ["int2", "smallserial"],
    ]) {
      expect(
        defaultOps(snapshot(live, NEXTVAL), snapshot(desired, undefined)),
        desired
      ).toHaveLength(0);
    }
  });

  it("reports the change when the column is no longer serial", () => {
    // serial → integer drops the sequence. Suppressing this would leave the
    // column drawing from it forever, and the type comparison cannot catch it
    // because `serial` and `integer` share a storage type.
    expect(
      defaultOps(snapshot("int4", NEXTVAL), snapshot("integer", undefined))
    ).toHaveLength(1);
  });

  it("still reports a sequence default replaced by a real one", () => {
    expect(
      defaultOps(snapshot("int4", NEXTVAL), snapshot("serial", "42"))
    ).toHaveLength(1);
  });
});
