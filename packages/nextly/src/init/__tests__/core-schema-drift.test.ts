/**
 * Detecting a database whose core tables are behind the running code.
 *
 * This is the shape of the failure that made a real playground database
 * unusable: `dynamic_collections` was created before `localized` and
 * `versions` existed, nothing added them on upgrade, and every collection
 * query failed with an error that named neither the cause nor the remedy.
 */
import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import {
  coreSchemaFingerprint,
  findCoreSchemaDrift,
  formatCoreSchemaDriftWarning,
} from "../core-schema-drift";

function snapshot(tables: Record<string, string[]>): NextlySchemaSnapshot {
  return {
    tables: Object.entries(tables).map(([name, columns]) => ({
      name,
      columns: columns.map(c => ({ name: c, type: "text", nullable: true })),
    })),
  };
}

describe("findCoreSchemaDrift", () => {
  it("reports a column the code expects that the database lacks", () => {
    const drift = findCoreSchemaDrift(
      snapshot({ dynamic_collections: ["id", "slug"] }),
      snapshot({ dynamic_collections: ["id", "slug", "localized", "versions"] })
    );

    expect(drift).toEqual([
      {
        table: "dynamic_collections",
        missingColumns: ["localized", "versions"],
      },
    ]);
  });

  it("reports nothing when the database matches", () => {
    const same = { nextly_events: ["id", "type", "retention_class"] };
    expect(findCoreSchemaDrift(snapshot(same), snapshot(same))).toEqual([]);
  });

  it("ignores extra live columns, which an upgrade does not need to act on", () => {
    const drift = findCoreSchemaDrift(
      snapshot({ media: ["id", "tags", "legacy_field"] }),
      snapshot({ media: ["id", "tags"] })
    );
    expect(drift).toEqual([]);
  });

  it("ignores a table missing entirely, which is a different failure", () => {
    // A first run creates tables; a table absent here means something other
    // than a pending upgrade, and the boot path is the wrong place to guess.
    const drift = findCoreSchemaDrift(
      snapshot({ media: ["id"] }),
      snapshot({ media: ["id"], nextly_versions: ["id", "entity"] })
    );
    expect(drift).toEqual([]);
  });

  it("compares column names case-insensitively", () => {
    const drift = findCoreSchemaDrift(
      snapshot({ Media: ["ID", "Tags"] }),
      snapshot({ media: ["id", "tags"] })
    );
    expect(drift).toEqual([]);
  });
});

describe("coreSchemaFingerprint", () => {
  it("is stable across table and column ordering", () => {
    const a = snapshot({ b: ["y", "x"], a: ["m"] });
    const b = snapshot({ a: ["m"], b: ["x", "y"] });
    expect(coreSchemaFingerprint(a)).toBe(coreSchemaFingerprint(b));
  });

  it("changes when a column is added", () => {
    const before = coreSchemaFingerprint(snapshot({ t: ["a"] }));
    const after = coreSchemaFingerprint(snapshot({ t: ["a", "b"] }));
    expect(after).not.toBe(before);
  });

  it("does not change when only a column type changes", () => {
    // Types do not round-trip cleanly between the desired and live sides yet,
    // so including them would flag drift that is not drift.
    const base = snapshot({ t: ["a"] });
    const retyped: NextlySchemaSnapshot = {
      tables: [
        {
          name: "t",
          columns: [{ name: "a", type: "integer", nullable: true }],
        },
      ],
    };
    expect(coreSchemaFingerprint(retyped)).toBe(coreSchemaFingerprint(base));
  });
});

describe("formatCoreSchemaDriftWarning", () => {
  it("names the columns and the command to run", () => {
    const message = formatCoreSchemaDriftWarning([
      { table: "audit_log", missingColumns: ["metadata"] },
    ]);

    expect(message).toContain("audit_log: metadata");
    expect(message).toContain("nextly migrate");
    // The silent-failure consequence is the reason this is worth reading.
    expect(message).toContain("silently do nothing");
  });
});
