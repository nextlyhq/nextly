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
});
