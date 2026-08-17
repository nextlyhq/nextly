/**
 * Whether the autosave concurrency token can reach a database that already
 * exists.
 *
 * The token is only worth having if every installation gets it. A database
 * created before this column existed is upgraded by `nextly migrate` Phase 1,
 * which introspects the live core tables, diffs them against `getCoreSchema`
 * and classifies the result under `production-strict`. Two properties decide
 * whether that path applies the column or refuses the whole migration, and
 * neither is visible from the schema file:
 *
 *   - the table must be part of the core snapshot at all, since the diff only
 *     considers tables it finds there;
 *   - the column must carry a DEFAULT, because `production-strict` refuses an
 *     `add_column` that is NOT NULL with none. Refusing is the safe behaviour
 *     for a column that would fail at apply time, and here it would mean every
 *     existing installation's migration stops rather than the column being
 *     silently skipped.
 *
 * Both are asserted against the real snapshot and the real classifier rather
 * than restated, so dropping `.default(0)` fails here instead of at a user's
 * `migrate`.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { classifyForMode } from "../../../domains/schema/pipeline/classifier/modes";
import type { AddColumnOp } from "../../../domains/schema/pipeline/diff/types";
import { getCoreSchema } from "../../index";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe.each(DIALECTS)("nextly_versions.revision on %s", dialect => {
  const table = getCoreSchema(dialect).tables.find(
    t => t.name === "nextly_versions"
  );
  const column = table?.columns.find(c => c.name === "revision");

  it("is part of the core snapshot the reconcile diffs against", () => {
    // The positive control for everything below: a column the snapshot does not
    // contain produces no operation at all, and a test that only asserted "no
    // refusal" would pass on exactly that.
    expect(table).toBeDefined();
    expect(column).toBeDefined();
  });

  it("declares a default, so adding it to an existing table is not refused", () => {
    expect(column?.nullable).toBe(false);
    // The value itself, not merely that one is present. A default the diff
    // cannot render lands as `undefined` here, which is the refusing case.
    expect(column?.default).toBe("0");
  });

  it("classifies as applicable under production-strict", () => {
    // Narrowed by a throw rather than a non-null assertion: an absent column
    // would otherwise reach the classifier as `undefined` and fail there with
    // a message about a property access, naming neither this table nor why it
    // matters.
    if (!column) {
      throw new Error("nextly_versions.revision is absent from the snapshot");
    }

    const op: AddColumnOp = {
      type: "add_column",
      tableName: "nextly_versions",
      // The column as the snapshot actually describes it. Constructing one by
      // hand would assert the classifier's rule against a value this schema
      // may not produce, which is the agreement being tested.
      column,
    };

    const result = classifyForMode([op], dialect, "production-strict");

    expect(result.verdict).toBe("apply");
  });
});
