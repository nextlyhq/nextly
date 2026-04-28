// Unit tests for applyMakeOptionalToSnapshot.

import { describe, it, expect } from "vitest";

import type { NextlySchemaSnapshot } from "../../diff/types.js";
import type { ClassifierEvent, Resolution } from "../../resolution/types.js";
import { applyMakeOptionalToSnapshot } from "../snapshot-patch.js";

describe("applyMakeOptionalToSnapshot", () => {
  it("flips nullable=true on the resolved event's column", () => {
    const snapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_users",
          columns: [
            { name: "id", type: "text", nullable: false },
            { name: "email", type: "text", nullable: false },
          ],
        },
      ],
    };
    const event: ClassifierEvent = {
      id: "add_not_null_with_nulls:dc_users.email",
      kind: "add_not_null_with_nulls",
      tableName: "dc_users",
      columnName: "email",
      nullCount: 3,
      tableRowCount: 47,
      applicableResolutions: ["provide_default", "make_optional", "abort"],
    };
    const resolution: Resolution = {
      kind: "make_optional",
      eventId: event.id,
    };
    const patched = applyMakeOptionalToSnapshot(
      snapshot,
      [resolution],
      [event]
    );
    expect(patched.tables[0].columns[1].nullable).toBe(true);
    expect(patched.tables[0].columns[0].nullable).toBe(false);
  });

  it("returns the original snapshot when no make_optional resolutions", () => {
    const snapshot: NextlySchemaSnapshot = { tables: [] };
    const out = applyMakeOptionalToSnapshot(snapshot, [], []);
    expect(out).toBe(snapshot);
  });

  it("ignores make_optional with unknown event id (defensive no-op)", () => {
    const snapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_users",
          columns: [{ name: "email", type: "text", nullable: false }],
        },
      ],
    };
    const resolution: Resolution = {
      kind: "make_optional",
      eventId: "add_not_null_with_nulls:no.such",
    };
    const out = applyMakeOptionalToSnapshot(snapshot, [resolution], []);
    expect(out.tables[0].columns[0].nullable).toBe(false);
  });

  it("works for add_required_field_no_default events too", () => {
    const snapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_users",
          columns: [{ name: "phone", type: "text", nullable: false }],
        },
      ],
    };
    const event: ClassifierEvent = {
      id: "add_required_field_no_default:dc_users.phone",
      kind: "add_required_field_no_default",
      tableName: "dc_users",
      columnName: "phone",
      tableRowCount: 50,
      applicableResolutions: ["provide_default", "make_optional", "abort"],
    };
    const out = applyMakeOptionalToSnapshot(
      snapshot,
      [{ kind: "make_optional", eventId: event.id }],
      [event]
    );
    expect(out.tables[0].columns[0].nullable).toBe(true);
  });

  it("does NOT mutate the original snapshot (immutable patch)", () => {
    const snapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_users",
          columns: [{ name: "email", type: "text", nullable: false }],
        },
      ],
    };
    const event: ClassifierEvent = {
      id: "add_not_null_with_nulls:dc_users.email",
      kind: "add_not_null_with_nulls",
      tableName: "dc_users",
      columnName: "email",
      nullCount: 3,
      tableRowCount: 47,
      applicableResolutions: ["make_optional"],
    };
    const out = applyMakeOptionalToSnapshot(
      snapshot,
      [{ kind: "make_optional", eventId: event.id }],
      [event]
    );
    expect(snapshot.tables[0].columns[0].nullable).toBe(false);
    expect(out.tables[0].columns[0].nullable).toBe(true);
    expect(out).not.toBe(snapshot);
  });

  it("ignores type_change events (those don't have make_optional resolutions)", () => {
    const snapshot: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_users",
          columns: [{ name: "age", type: "int", nullable: false }],
        },
      ],
    };
    const event: ClassifierEvent = {
      id: "type_change:dc_users.age",
      kind: "type_change",
      tableName: "dc_users",
      columnName: "age",
      fromType: "text",
      toType: "int",
      isWidening: false,
      perDialectWarning: { pg: "", mysql: "", sqlite: "" },
    };
    // Even if make_optional is somehow attached to a type_change (shouldn't
    // happen — applicableResolutions excludes it — but defensively):
    const out = applyMakeOptionalToSnapshot(
      snapshot,
      [{ kind: "make_optional", eventId: event.id }],
      [event]
    );
    expect(out.tables[0].columns[0].nullable).toBe(false);
  });
});
