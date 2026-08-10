/**
 * A `serial` column's sequence default belongs to the type: PostgreSQL reports
 * `nextval('<table>_id_seq'::regclass)` while the desired side declares no
 * default at all. Read literally that is a default being dropped on every
 * reconcile, so it is suppressed — but only for the sequence the column owns,
 * and only while the column is still declared serial. A sequence default
 * pointed anywhere else was set deliberately, and removing it is a real
 * change.
 */
import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../diff";
import type { ColumnSpec, NextlySchemaSnapshot } from "../types";

/** What PostgreSQL renders for the sequence a `serial` column owns. */
const OWNED_NEXTVAL = "nextval('t_id_seq'::regclass)";
/** A sequence the column does not own, created and pointed at by hand. */
const CUSTOM_NEXTVAL = "nextval('custom_seq'::regclass)";

function snapshot(
  type: string,
  columnDefault: string | undefined,
  ownedSequenceDefault?: boolean
): NextlySchemaSnapshot {
  const column: ColumnSpec = {
    name: "id",
    type,
    nullable: false,
    default: columnDefault,
  };
  if (ownedSequenceDefault) column.ownedSequenceDefault = true;
  return { tables: [{ name: "t", columns: [column], indexes: [] }] };
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
      defaultOps(
        snapshot("int4", OWNED_NEXTVAL, true),
        snapshot("serial", undefined)
      )
    ).toHaveLength(0);
  });

  it("covers bigserial and smallserial", () => {
    for (const [live, desired] of [
      ["int8", "bigserial"],
      ["int2", "smallserial"],
    ]) {
      expect(
        defaultOps(
          snapshot(live, OWNED_NEXTVAL, true),
          snapshot(desired, undefined)
        ),
        desired
      ).toHaveLength(0);
    }
  });

  it("reports the change when the column is no longer serial", () => {
    // serial → integer drops the sequence. Suppressing this would leave the
    // column drawing from it forever, and the type comparison cannot catch it
    // because `serial` and `integer` share a storage type.
    expect(
      defaultOps(
        snapshot("int4", OWNED_NEXTVAL, true),
        snapshot("integer", undefined)
      )
    ).toHaveLength(1);
  });

  it("still reports a sequence default replaced by a real one", () => {
    expect(
      defaultOps(
        snapshot("int4", OWNED_NEXTVAL, true),
        snapshot("serial", "42")
      )
    ).toHaveLength(1);
  });

  it("reports a default drawing from a sequence the column does not own", () => {
    // A serial column can be repointed at another sequence. The expression
    // looks exactly like the implicit one, so only ownership separates them —
    // and the desired side declaring no default means that repointing is
    // being undone, which is a change the diff has to emit.
    expect(
      defaultOps(
        snapshot("int4", CUSTOM_NEXTVAL, false),
        snapshot("serial", undefined)
      )
    ).toHaveLength(1);
  });

  it("reports a sequence default on a snapshot that never recorded ownership", () => {
    // Snapshots written before ownership was tracked carry no marker. They
    // read as "not known to be owned", which costs a spurious op rather than
    // a swallowed one.
    expect(
      defaultOps(
        snapshot("int4", OWNED_NEXTVAL, undefined),
        snapshot("serial", undefined)
      )
    ).toHaveLength(1);
  });
});
