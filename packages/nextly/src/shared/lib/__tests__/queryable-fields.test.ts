/**
 * Which fields a caller may use to choose rows, judged from the field's read
 * rule for that caller with no entry.
 *
 * Two ways a rule's answer can be right by accident and still open the field
 * to probing, each pinned here: a rule that reads the entry, which with no
 * entry and no user compares `undefined` with `undefined`; and a field whose
 * read value is not its stored value, so a query on the stored value probes
 * what every returned row hides.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../field-level-registry";
import {
  assertFilterableFields,
  assertSortableField,
  filterSearchableFields,
} from "../filterable-fields";

const SLUG = "vaults";

afterEach(() => {
  clearFieldFunctions();
});

/** The serialized refusal, failing when the guard accepted. */
async function refusalOf(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return JSON.stringify(error);
  }
  return expect.unreachable("should have refused");
}

describe("a rule that reads the entry", () => {
  it.each([
    ["data", ({ data, req }: RuleArgs) => data?.owner === req.user?.id],
    ["id", ({ id, req }: RuleArgs) => id === req.user?.id],
  ])(
    "is entry-dependent when it reads %s, whatever it answers",
    async (_name, read) => {
      registerFieldFunctions("collection", SLUG, [
        { name: "note", type: "text", access: { read } },
      ]);
      // No user: the comparison is `undefined === undefined`, true by accident.
      expect(
        await refusalOf(
          assertFilterableFields("collection", SLUG, { note: { equals: "x" } })
        )
      ).toContain("FIELD_NOT_FILTERABLE");
      expect(
        await refusalOf(assertSortableField("collection", SLUG, "note"))
      ).toContain("FIELD_NOT_SORTABLE");
      await expect(
        filterSearchableFields("collection", SLUG, ["note"])
      ).resolves.toEqual([]);
    }
  );

  it("CONTROL: a rule that reads only the caller is judged by its answer", async () => {
    registerFieldFunctions("collection", SLUG, [
      {
        name: "note",
        type: "text",
        access: { read: ({ req }: RuleArgs) => req.user?.id === "boss" },
      },
    ]);
    await expect(
      assertFilterableFields(
        "collection",
        SLUG,
        { note: { equals: "x" } },
        { caller: { user: { id: "boss" } } }
      )
    ).resolves.toBeUndefined();
  });
});

describe("a field transformed when it is read", () => {
  function registerMasked(): void {
    registerFieldFunctions("collection", SLUG, [
      {
        name: "card",
        type: "text",
        access: { read: () => true },
        hooks: {
          afterRead: [
            ({ value }: { value: unknown }) => `****${String(value).slice(-4)}`,
          ],
        },
      },
    ]);
  }

  it("stays out of filters, sorts and search though its read rule allows", async () => {
    // Every row shows the masked value, so a query on the stored one would
    // probe exactly what the rows hide.
    registerMasked();
    expect(
      await refusalOf(
        assertFilterableFields("collection", SLUG, {
          card: { like: "4111" },
        })
      )
    ).toContain("FIELD_NOT_FILTERABLE");
    expect(
      await refusalOf(assertSortableField("collection", SLUG, "card"))
    ).toContain("FIELD_NOT_SORTABLE");
    await expect(
      filterSearchableFields("collection", SLUG, ["card"])
    ).resolves.toEqual([]);
  });
});

interface RuleArgs {
  req: { user?: { id?: unknown } };
  id?: string;
  data?: Record<string, unknown>;
}
