/**
 * Which copies of a field group's fields a host's save may carry (`refuseFieldGroupFieldsChangedInHost`):
 * every copy is compared with the field group's own stored fields, each on its own, so one copy
 * that matches never stands for another beside it that does not; the field groups a copy places
 * are compared with their own in turn; and a copy that matches, as a read hands it out, passes.
 */
import { describe, expect, it, vi } from "vitest";

import { refuseFieldGroupFieldsChangedInHost } from "../field-group-fields-read-only";

type Field = Record<string, unknown>;

const NOTE: Field = { name: "note", type: "text" };
const SUMMARY: Field = { name: "summary", type: "text" };
const EDITED: Field[] = [NOTE, { ...SUMMARY, required: true }];

/** `badge` holds a note; `card` holds a note, a summary and the field group `badge`. */
const BADGE_FIELDS: Field[] = [NOTE];
const BADGE_REF: Field = {
  name: "badge",
  type: "component",
  component: "badge",
};
const CARD_FIELDS: Field[] = [NOTE, SUMMARY, BADGE_REF];

/** The field groups as stored, read through a counter so a test can see they are read once. */
function stored(card: Field[] = CARD_FIELDS) {
  const getAllFieldLists = vi.fn(async () => [
    { slug: "card", fields: card },
    { slug: "badge", fields: BADGE_FIELDS },
  ]);
  return { getAllFieldLists };
}

const cardRef = (extra: Field): Field => ({
  name: "card",
  type: "component",
  component: "card",
  ...extra,
});

const refusedNaming = (slug: string) =>
  expect.objectContaining({
    publicData: {
      errors: [
        expect.objectContaining({
          code: "FIELD_GROUP_READ_ONLY",
          message: expect.stringContaining(`holds the field group ${slug}`),
        }),
      ],
    },
  });

describe("refuseFieldGroupFieldsChangedInHost", () => {
  it("passes every copy a read hands out, each as stored", async () => {
    const fieldGroups = stored();
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [
          cardRef({
            fields: CARD_FIELDS,
            componentFields: [
              NOTE,
              SUMMARY,
              { ...BADGE_REF, componentFields: BADGE_FIELDS },
            ],
            componentSchemas: { card: { fields: CARD_FIELDS } },
          }),
        ],
        fieldGroups
      )
    ).resolves.toBeUndefined();
    // All read together, once, however many copies of them the save carries.
    expect(fieldGroups.getAllFieldLists).toHaveBeenCalledTimes(1);
  });

  it("refuses a changed componentFields beside an unchanged fields", async () => {
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [cardRef({ fields: CARD_FIELDS, componentFields: [NOTE, SUMMARY] })],
        stored()
      )
    ).rejects.toThrow(refusedNaming("card"));
  });

  it("refuses a changed fields beside a componentSchemas copy that matches", async () => {
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [
          cardRef({
            fields: [...EDITED, BADGE_REF],
            componentSchemas: { card: { fields: CARD_FIELDS } },
          }),
        ],
        stored()
      )
    ).rejects.toThrow(refusedNaming("card"));
  });

  it("refuses an edit to a field group placed inside another's copy, naming the inner one", async () => {
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [
          cardRef({
            componentFields: [
              NOTE,
              SUMMARY,
              { ...BADGE_REF, componentFields: [NOTE, SUMMARY] },
            ],
          }),
        ],
        stored()
      )
    ).rejects.toThrow(refusedNaming("badge"));
  });

  it("finds a field-group field inside a group or a repeater", async () => {
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [
          {
            name: "rows",
            type: "repeater",
            fields: [
              {
                name: "meta",
                type: "group",
                fields: [cardRef({ fields: EDITED })],
              },
            ],
          },
        ],
        stored()
      )
    ).rejects.toThrow(refusedNaming("card"));
  });

  // Only a read's additions to a field-group field are left out of the comparison: the same key
  // on another type's field is an option of its own, whose change a host's copy shows.
  it.each(["componentFields", "componentSchemas"] as const)(
    "refuses a change to another type's %s option inside a copy",
    async key => {
      const themed = (value: unknown): Field[] => [
        ...CARD_FIELDS,
        { name: "theme", type: "palette", [key]: value },
      ];
      const fieldGroups = stored(themed(["a"]));
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: themed(["b"]) })],
          fieldGroups
        )
      ).rejects.toThrow(refusedNaming("card"));
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: themed(["a"]) })],
          fieldGroups
        )
      ).resolves.toBeUndefined();
    }
  );

  // A save holds the schema exclusion while it is checked, so the field groups it uses are read
  // together: one read however many of them there are.
  it.each([1, 5])(
    "reads the field groups once for a save using %i of them",
    async many => {
      const slugs = Array.from({ length: many }, (_, at) => `group${at}`);
      const getAllFieldLists = vi.fn(async () =>
        slugs.map(slug => ({ slug, fields: [NOTE] }))
      );
      await refuseFieldGroupFieldsChangedInHost(
        slugs.map(slug => ({
          name: slug,
          type: "component",
          component: slug,
          fields: [NOTE],
        })),
        { getAllFieldLists }
      );
      expect(getAllFieldLists).toHaveBeenCalledTimes(1);
    }
  );

  it("reads no field group for a save that copies none", async () => {
    const getAllFieldLists = vi.fn(async () => []);
    await refuseFieldGroupFieldsChangedInHost([NOTE, SUMMARY], {
      getAllFieldLists,
    });
    expect(getAllFieldLists).not.toHaveBeenCalled();
  });

  it("leaves a field group it does not hold to the save's own checks", async () => {
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [
          {
            name: "gone",
            type: "component",
            component: "gone",
            fields: [NOTE],
          },
        ],
        stored()
      )
    ).resolves.toBeUndefined();
  });

  describe("a copy the host already holds", () => {
    const heldCard = [NOTE, SUMMARY];

    it("passes, though the field group has changed since, where a copy no one holds is refused", async () => {
      const held = () => [
        {
          name: "meta",
          type: "group",
          fields: [cardRef({ fields: heldCard })],
        },
      ];
      await expect(
        refuseFieldGroupFieldsChangedInHost(held(), stored(), held)
      ).resolves.toBeUndefined();
      // The field renamed, or its group, with the copy it holds.
      for (const renamed of [
        [
          {
            name: "meta",
            type: "group",
            fields: [cardRef({ name: "box", fields: heldCard })],
          },
        ],
        [
          {
            name: "info",
            type: "group",
            fields: [cardRef({ fields: heldCard })],
          },
        ],
      ]) {
        await expect(
          refuseFieldGroupFieldsChangedInHost(renamed, stored(), held)
        ).resolves.toBeUndefined();
      }
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: EDITED })],
          stored(),
          held
        )
      ).rejects.toThrow(refusedNaming("card"));
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: heldCard })],
          stored()
        )
      ).rejects.toThrow(refusedNaming("card"));
    });

    it("stands in for no other field group's", async () => {
      const heldBadge = [{ ...NOTE, required: true }];
      const held = () => [
        cardRef({ fields: heldCard }),
        { ...BADGE_REF, fields: heldBadge },
      ];
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: heldBadge })],
          stored(),
          held
        )
      ).rejects.toThrow(refusedNaming("card"));
    });

    it("passes with the copy of a field group it places, held inside it", async () => {
      const heldBadge = [{ ...NOTE, required: true }];
      const copy = [NOTE, { ...BADGE_REF, fields: heldBadge }];
      const host = [cardRef({ fields: copy })];
      await expect(
        refuseFieldGroupFieldsChangedInHost(host, stored(), () => host)
      ).resolves.toBeUndefined();
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: [NOTE, { ...BADGE_REF, fields: [SUMMARY] }] })],
          stored([NOTE, { ...BADGE_REF, fields: [SUMMARY] }]),
          () => host
        )
      ).rejects.toThrow(refusedNaming("badge"));
    });

    // A copy the host holds stands for one copy in the save: beside the field that holds it, another
    // naming the same field group takes none. A host that holds the copy twice keeps it twice.
    const other = (extra: Field): Field => cardRef({ name: "other", ...extra });
    const third = cardRef({ name: "third", fields: heldCard });
    const holding = cardRef({ fields: heldCard });
    const copied = other({ fields: heldCard });
    const meta = (...fields: Field[]): Field => ({
      name: "meta",
      type: "group",
      fields,
    });
    it.each<[string, Field[], Field[]]>([
      ["a new field", [holding], [holding, copied]],
      ["one that held none", [holding, other({})], [holding, copied]],
      [
        "one that held another copy",
        [holding, other({ fields: EDITED })],
        [holding, copied],
      ],
      [
        "one in a group",
        [holding, meta(cardRef({}))],
        [holding, meta(holding)],
      ],
      [
        "one beside the group that holds it",
        [meta(holding), cardRef({})],
        [meta(holding), holding],
      ],
      ["a third of two", [holding, copied], [holding, copied, third]],
    ])(
      "stands for one copy, not for another field's naming the same field group: %s",
      async (_what, held, sent) => {
        await expect(
          refuseFieldGroupFieldsChangedInHost(sent, stored(), () => held)
        ).rejects.toThrow(refusedNaming("card"));
        // The host sent back as it is goes through.
        await expect(
          refuseFieldGroupFieldsChangedInHost(held, stored(), () => held)
        ).resolves.toBeUndefined();
      }
    );

    it("is read once, and only where a copy differs from its field group", async () => {
      const held = vi.fn(() => [
        cardRef({ fields: heldCard }),
        cardRef({ name: "other", fields: heldCard }),
      ]);
      await refuseFieldGroupFieldsChangedInHost(
        [cardRef({ fields: CARD_FIELDS })],
        stored(),
        held
      );
      expect(held).not.toHaveBeenCalled();
      await refuseFieldGroupFieldsChangedInHost(
        [cardRef({ fields: heldCard }), cardRef({ fields: heldCard })],
        stored(),
        held
      );
      expect(held).toHaveBeenCalledTimes(1);
    });
  });

  // What the Schema Builder writes on a field that leaves it out says nothing new; the same keys
  // set to anything else are an edit.
  it("takes a copy with the Schema Builder's spelling of its fields, and refuses what it would change", async () => {
    const CHOICE: Field = {
      name: "choice",
      type: "select",
      options: [{ label: "A", value: "a" }],
    };
    const card = [NOTE, CHOICE];
    const spelled = [
      { ...NOTE, label: "note", required: false, unique: false, index: false },
      {
        ...CHOICE,
        label: "choice",
        options: [{ id: "opt_1_0_a", label: "A", value: "a" }],
      },
    ];
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [cardRef({ fields: spelled })],
        stored(card)
      )
    ).resolves.toBeUndefined();
    for (const changed of [
      { ...NOTE, required: true },
      { ...NOTE, unique: true },
      { ...NOTE, index: true },
      { ...NOTE, label: "Note" },
      { ...NOTE, localized: false },
    ]) {
      await expect(
        refuseFieldGroupFieldsChangedInHost(
          [cardRef({ fields: [changed, CHOICE] })],
          stored(card)
        )
      ).rejects.toThrow(refusedNaming("card"));
    }
    await expect(
      refuseFieldGroupFieldsChangedInHost(
        [
          cardRef({
            fields: [
              NOTE,
              { ...CHOICE, options: [{ label: "A", value: "b" }] },
            ],
          }),
        ],
        stored(card)
      )
    ).rejects.toThrow(refusedNaming("card"));
  });
});
