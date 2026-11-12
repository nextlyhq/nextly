/**
 * A form saved to take one response per email has an Email field it can
 * compare, however it is saved: the API refuses one with none chosen, a
 * missing or non-Email field, an optional one or one a condition hides, and
 * a later save of the fields or the settings alone that would leave it so.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

const EMAIL = { type: "email", name: "email", label: "Email", required: true };
const NAME = { type: "text", name: "name", label: "Name" };

describe.each(getConfiguredTestDialects())(
  "one response per email's field (%s)",
  dialect => {
    let current: TestNextly | undefined;
    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      current = await createTestNextly({
        dialect,
        plugins: [formBuilder().plugin],
      });
      const nextly = current.nextly;
      let made = 0;
      const create = (
        fields: Record<string, unknown>[],
        settings: Record<string, unknown>
      ) =>
        nextly.create({
          collection: "forms",
          data: {
            name: "Meetup",
            slug: `meetup-${(made += 1)}`,
            status: "published",
            fields,
            settings,
          },
        });
      return { nextly, create };
    }

    const byEmail = (oneResponseField?: string) => ({
      oneResponse: "email",
      ...(oneResponseField === undefined ? {} : { oneResponseField }),
    });

    it("takes a required Email field no condition hides", async () => {
      const { create } = await boot();
      await expect(
        create([NAME, EMAIL], byEmail("email"))
      ).resolves.toBeTruthy();
    });

    it("refuses one per email with no field it can compare", async () => {
      const { create } = await boot();
      const cases: [Record<string, unknown>[], Record<string, unknown>][] = [
        [[EMAIL], byEmail()],
        [[EMAIL], byEmail("missing")],
        [[NAME, EMAIL], byEmail("name")],
        [[{ ...EMAIL, required: false }], byEmail("email")],
        [
          [
            NAME,
            {
              ...EMAIL,
              conditionalLogic: {
                enabled: true,
                action: "show",
                operator: "AND",
                conditions: [
                  { field: "name", comparison: "is_not_empty", value: "" },
                ],
              },
            },
          ],
          byEmail("email"),
        ],
      ];
      for (const [fields, settings] of cases) {
        await expect(create(fields, settings)).rejects.toThrow();
      }
    });

    it("refuses a later save that leaves the chosen field unusable", async () => {
      const { nextly, create } = await boot();
      const made = await create([EMAIL], byEmail("email"));
      const id = String(made.item.id);
      // The fields alone, judged against the stored settings.
      await expect(
        nextly.update({
          collection: "forms",
          id,
          data: { fields: [{ ...EMAIL, required: false }], _overwrite: true },
        })
      ).rejects.toThrow();
      // The settings alone, judged against the stored fields.
      await expect(
        nextly.update({
          collection: "forms",
          id,
          data: { settings: byEmail("missing"), _overwrite: true },
        })
      ).rejects.toThrow();
      // A form that stops comparing by email may then change the field.
      await nextly.update({
        collection: "forms",
        id,
        data: { settings: { oneResponse: "off" }, _overwrite: true },
      });
      await expect(
        nextly.update({
          collection: "forms",
          id,
          data: { fields: [{ ...EMAIL, required: false }], _overwrite: true },
        })
      ).resolves.toBeTruthy();
    });

    it("takes a save that clears the settings while changing the field", async () => {
      const { nextly, create } = await boot();
      const made = await create([EMAIL], byEmail("email"));
      // Cleared settings take one response per email off, so the field the
      // stored settings compared is free to change in the same save.
      await expect(
        nextly.update({
          collection: "forms",
          id: String(made.item.id),
          data: {
            settings: null,
            fields: [{ ...EMAIL, required: false }],
            _overwrite: true,
          },
        })
      ).resolves.toBeTruthy();
    });
  }
);
