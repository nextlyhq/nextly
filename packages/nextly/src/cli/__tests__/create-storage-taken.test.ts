/**
 * Every refusal of a field group's or Single's create over storage nothing registered owns ends a
 * command as `CREATE_STORAGE_TAKEN`, read from the refusal as the create throws it.
 *
 * Each case builds its refusal through the builder the create itself throws, so a change to a
 * refusal's reason or wording that the code no longer reads fails here: the error would end as
 * `UNEXPECTED_ERROR`, or its parts would lose what happened, why or what to do.
 */
import { describe, expect, it } from "vitest";

import {
  occupiedRefusal,
  referencedRefusal,
  takenRefusal,
  viewedRefusal,
} from "../../domains/schema/services/leftover-storage";
import { toCliError } from "../errors";

const SINGLE = {
  kind: "single",
  slug: "home",
  tableName: "single_home",
} as const;
const GROUP = {
  kind: "fieldGroup",
  slug: "card",
  tableName: "comp_card",
} as const;

describe("a create refused over storage nothing registered owns", () => {
  const cases = [
    {
      refusal: "a table standing where it would build",
      error: takenRefusal(SINGLE, ["home_links"]),
      what: 'Creating the Single "home" was refused.',
      why: '"home_links" stands where it would build, and nothing registered owns it.',
      next: "Drop or rename it, then retry the create.",
    },
    {
      refusal: "a leftover table other tables reference",
      error: referencedRefusal(SINGLE, ["dc_audit"]),
      what: 'Creating the Single "home" was refused.',
      why: '"single_home" already exists, and "dc_audit" references it, which nothing registered owns.',
      next: 'Drop that table or its reference to "single_home", or rename "single_home" itself, then retry the create.',
    },
    {
      refusal: "a leftover table holding rows",
      error: occupiedRefusal(GROUP, [{ table: "comp_card", rows: 2 }]),
      what: 'Creating the field group "card" was refused.',
      why: '"comp_card" (2 rows) already exists and holds rows, but nothing registered describes them.',
      next: "Drop or rename those tables, then retry the create.",
    },
    {
      refusal: "a view reading the tables it would replace",
      error: viewedRefusal(GROUP, ["card_report"]),
      what: 'Creating the field group "card" was refused.',
      why: 'The view "card_report" reads the tables it would replace, and nothing registered owns it.',
      next: "Drop it, or redefine it to read other tables, then retry the create.",
    },
  ];

  for (const { refusal, error, what, why, next } of cases) {
    it(`reads ${refusal} as its own code, with what happened, why and what to do`, () => {
      const ended = toCliError(error);
      expect(ended.code).toBe("CREATE_STORAGE_TAKEN");
      expect({ what: ended.what, why: ended.why, next: ended.next }).toEqual({
        what,
        why,
        next,
      });
    });
  }

  // A shared field-group table holds other entities' rows, so the advice keeps the table and
  // removes only the rows naming the leftover as their parent.
  it("tells the owner of shared field-group rows to delete only those rows, never the table", () => {
    const ended = toCliError(
      occupiedRefusal(SINGLE, [], [{ table: "comp_chip", rows: 1 }])
    );
    expect(ended.code).toBe("CREATE_STORAGE_TAKEN");
    expect(ended.why).toBe(
      'The shared field-group table "comp_chip" (1 row) holds rows whose `_parent_table` is "single_home", which nothing registered owns.'
    );
    expect(ended.next).toBe(
      'Delete only the rows whose `_parent_table` is "single_home" from that table, keeping the table and every other row, then retry the create.'
    );
    expect(ended.next).not.toMatch(/drop|rename/i);
  });

  it("gives each remedy when the leftover's own tables and shared rows both hold content", () => {
    const ended = toCliError(
      occupiedRefusal(
        SINGLE,
        [{ table: "single_home", rows: 3 }],
        [
          { table: "comp_chip", rows: 1 },
          { table: "comp_card", rows: 2 },
        ]
      )
    );
    expect(ended.why).toBe(
      '"single_home" (3 rows) already exists and holds rows, but nothing registered describes them. The shared field-group tables "comp_chip" (1 row), "comp_card" (2 rows) hold rows whose `_parent_table` is "single_home", which nothing registered owns.'
    );
    expect(ended.next).toBe(
      'Drop or rename "single_home", and delete only the rows whose `_parent_table` is "single_home" from "comp_chip", "comp_card", keeping the tables and every other row, then retry the create.'
    );
  });

  // Renaming a view keeps it reading the same table, so the advice for one must not offer it.
  it("never tells a view's owner to rename it", () => {
    expect(toCliError(viewedRefusal(SINGLE, ["home_report"])).next).not.toMatch(
      /rename/i
    );
  });

  // Renaming a referencing table keeps its reference, so only the leftover itself is to be renamed.
  it("tells the owner of a referencing table to drop it or its reference, not to rename it", () => {
    const next = toCliError(
      referencedRefusal(GROUP, ["a_audit", "b_audit"])
    ).next;
    expect(next).toBe(
      'Drop those tables or their references to "comp_card", or rename "comp_card" itself, then retry the create.'
    );
  });
});
