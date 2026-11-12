/**
 * What a submission was asked, kept with it, on every dialect: renaming a
 * field, relabelling an option or changing a condition afterwards leaves the
 * submission reading as it was answered; an answer staff edit to an option
 * added later keeps that option's label as it was when edited to; a row
 * stored before submissions kept this reads with the form as it is now; and
 * a caller cannot set what was asked.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";
import { askedFieldsOf, readAskedSnapshot } from "../utils/asked-fields";

const FIELDS = [
  { type: "text", name: "name", label: "Full name", required: true },
  {
    type: "select",
    name: "role",
    label: "Role",
    options: [
      { label: "Backend engineer", value: "backend" },
      { label: "Designer", value: "design" },
    ],
  },
  {
    type: "text",
    name: "portfolio",
    label: "Portfolio",
    conditionalLogic: {
      enabled: true,
      action: "show",
      operator: "AND",
      conditions: [{ field: "role", comparison: "equals", value: "design" }],
    },
  },
];

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
  });
  const t = current;
  const formId = String(
    (
      await t.nextly.create({
        collection: "forms",
        data: {
          name: "Jobs",
          slug: "jobs",
          status: "published",
          fields: FIELDS,
        },
      })
    ).item.id
  );
  const submit = async (data: Record<string, unknown>, extra = {}) =>
    String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: {
            form: formId,
            data,
            submittedAt: new Date().toISOString(),
            ...extra,
          },
        })
      ).item.id
    );
  const row = async (id: string) =>
    (await t.nextly.findByID({ collection: "form-submissions", id })) as {
      asked?: unknown;
      title?: string | null;
      data: Record<string, unknown>;
    };
  const setFields = (fields: unknown[]) =>
    t.nextly.update({
      collection: "forms",
      id: formId,
      data: { fields, _overwrite: true },
    });
  return { t, submit, row, setFields };
}

describe.each(getConfiguredTestDialects())(
  "what a submission was asked (%s)",
  dialect => {
    it("reads as answered after the form's field, option and condition change", async () => {
      const { submit, row, setFields } = await boot(dialect);
      const id = await submit({ name: "Hina Rossi", role: "backend" });

      await setFields([
        { ...FIELDS[0], label: "Name" },
        {
          ...FIELDS[1],
          options: [
            { label: "Platform engineer", value: "backend" },
            { label: "Designer", value: "design" },
          ],
        },
        { ...FIELDS[2], conditionalLogic: undefined },
      ]);

      const asked = readAskedSnapshot((await row(id)).asked);
      expect(asked?.fields.map(field => field.label)).toEqual([
        "Full name",
        "Role",
        "Portfolio",
      ]);
      expect(asked?.fields[1]?.options?.[0]).toEqual({
        value: "backend",
        label: "Backend engineer",
      });
      // Its condition hid the portfolio from this visitor, then and now.
      expect(asked?.hidden).toEqual(["portfolio"]);
    });

    it("keeps the label an answer was edited to", async () => {
      const { t, submit, row, setFields } = await boot(dialect);
      const id = await submit({ name: "Hina Rossi", role: "backend" });
      const withData = (options: unknown[]) => [
        FIELDS[0],
        { ...FIELDS[1], options },
        FIELDS[2],
      ];
      await setFields(
        withData([
          ...FIELDS[1]!.options!,
          { label: "Data engineer", value: "data" },
        ])
      );
      await t.nextly.update({
        collection: "form-submissions",
        id,
        data: { data: { name: "Hina Rossi", role: "data" }, _overwrite: true },
      });
      await setFields(
        withData([
          ...FIELDS[1]!.options!,
          { label: "Analytics engineer", value: "data" },
        ])
      );

      const asked = readAskedSnapshot((await row(id)).asked);
      const role = asked?.fields.find(field => field.name === "role");
      expect(
        role?.options?.find(option => option.value === "data")?.label
      ).toBe("Data engineer");
      // The field it did not edit stays as the visitor was asked it.
      expect(asked?.fields[0]?.label).toBe("Full name");
    });

    it("reads a row stored before submissions kept this with the form as it is", async () => {
      const { t, submit, row, setFields } = await boot(dialect);
      const id = await submit({ name: "Hina Rossi", role: "backend" });
      await t.adapter.update(
        "dc_form_submissions",
        { asked: null },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      await setFields([{ ...FIELDS[0], label: "Name" }, FIELDS[1], FIELDS[2]]);

      const stored = await row(id);
      expect(readAskedSnapshot(stored.asked)).toBeUndefined();
      const fields = (
        (await t.nextly.find({ collection: "forms", limit: 1 })).items[0] as {
          fields: never[];
        }
      ).fields;
      expect(
        askedFieldsOf(stored.asked, fields, stored.data).fields[0]?.label
      ).toBe("Name");
    });

    it("never takes what was asked from a caller", async () => {
      const { t, submit, row } = await boot(dialect);
      const forged = {
        fields: [{ name: "name", label: "Forged", type: "text" }],
        hidden: [],
      };
      const id = await submit(
        { name: "Hina Rossi", role: "backend" },
        { asked: forged }
      );
      // Nor from a patch that carries nothing else.
      await t.nextly.update({
        collection: "form-submissions",
        id,
        data: { asked: forged, _overwrite: true },
      });
      expect(readAskedSnapshot((await row(id)).asked)?.fields[0]?.label).toBe(
        "Full name"
      );
    });

    it("is titled by who sent it, never by a caller", async () => {
      const { t, submit, row } = await boot(dialect);
      const id = await submit(
        { name: "Hina Rossi", role: "backend" },
        { title: "Forged" }
      );
      expect((await row(id)).title).toBe("Hina Rossi");
      // Nor from a patch that carries nothing else.
      await t.nextly.update({
        collection: "form-submissions",
        id,
        data: { title: "Forged", _overwrite: true },
      });
      expect((await row(id)).title).toBe("Hina Rossi");
      await t.nextly.update({
        collection: "form-submissions",
        id,
        data: { data: { name: "Hina R.", role: "backend" }, _overwrite: true },
      });
      expect((await row(id)).title).toBe("Hina R.");
    });
  }
);
