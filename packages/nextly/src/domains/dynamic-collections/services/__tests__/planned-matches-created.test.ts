/**
 * A prediction of what a create artefact writes, against what it writes.
 *
 * A collection saved but not yet deployed has a registry record and no table, and the create and
 * the edit that follows it replay in order. So an edit made in that window is generated against a
 * table that does not exist yet, and everything it believes about that table is a PREDICTION —
 * `plannedAttachments` for the indexes and keys, `plannedColumnTypes` for the columns.
 *
 * Two artefacts can each be correct and wrong in sequence, which is the failure these exist to
 * stop: the create writes `double` for a float, a prediction reporting nothing sends MySQL's
 * restate to the legacy renderer, and the follow-up migration narrows the column the create had
 * just built.
 *
 * Compared to the EMITTED statement rather than to a literal per type. A literal on each side
 * passes while the two disagree — each is simply checked against its own expectation — and it is
 * the disagreement that does the damage.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";
const TABLE = "dc_planned";

/** Every shape whose column type the two renderers can disagree about. */
const FIELDS: FieldDefinition[] = [
  { name: "views", type: "number" },
  { name: "rating", type: "number", options: { format: "float" } },
  { name: "published", type: "checkbox" },
  { name: "headline", type: "text" },
  { name: "choice", type: "select", options: [{ label: "A", value: "a" }] },
] as unknown as FieldDefinition[];

/** The type the CREATE statement gives a column, read back out of the emitted DDL. */
function createdType(sql: string, column: string): string | null {
  const line = sql
    .split("\n")
    .find(l => new RegExp(`[\`"]${column}[\`"]\\s`).test(l));
  if (line === undefined) return null;
  const match = line
    .trim()
    .match(new RegExp(`[\`"]${column}[\`"]\\s+(.+?)(?:,|$)`));
  return match?.[1]?.trim().toLowerCase() ?? null;
}

describe.each<Dialect>(["postgresql", "mysql", "sqlite"])(
  "planned column types match the CREATE — %s",
  dialect => {
    const service = new DynamicCollectionSchemaService(undefined, dialect);
    const sql = service.generateMigrationSQL(TABLE, FIELDS, {});
    const planned = service.plannedColumnTypes(FIELDS);

    it("predicts a type for every column the create emits", () => {
      // The control: without it, a prediction that returned an EMPTY map would satisfy every
      // per-column assertion below by never reaching one.
      expect(planned.size).toBe(FIELDS.length);
    });

    it.each(FIELDS.map(f => [f.name] as const))(
      "agrees with the emitted column for %s",
      name => {
        const column = name.toLowerCase();
        const emitted = createdType(sql, column);
        expect(emitted).not.toBeNull();
        // NOT NULL, DEFAULT and UNIQUE ride on the same line; the prediction is the type alone.
        expect(emitted).toContain(planned.get(column));
      }
    );
  }
);
