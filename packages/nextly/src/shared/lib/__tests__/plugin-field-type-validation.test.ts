/**
 * A plugin-contributed field type can state rules about what it accepts.
 *
 * Without this seam a custom type is only ever checked as its storage
 * primitive: a `json`-backed type accepts any JSON, a `text`-backed one any
 * string. The type's own rules had nowhere to live, so a plugin could invent a
 * field and then say nothing about what belongs in it.
 *
 * The rules are declared on the TYPE rather than per field on purpose — every
 * instance gets them, rather than each schema author remembering to repeat a
 * `validate` function.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import type { PluginFieldValidationResult } from "../../../plugins/contributions";
import { validateEntryData, type ValidatableField } from "../entry-validation";

afterEach(() => {
  clearFieldTypes();
});

/** Register a custom type whose validate returns whatever the test wants. */
function registerRating(
  validate: (
    value: unknown,
    args: {
      data: Record<string, unknown>;
      req: Record<string, unknown>;
      field: { type: string; name?: string; readonly [k: string]: unknown };
      mode: "create" | "update";
    }
  ) => PluginFieldValidationResult | Promise<PluginFieldValidationResult>
): void {
  registerFieldType({
    type: "rating",
    storage: "number",
    component: "@acme/ratings/admin#RatingInput",
    validate,
  });
}

const FIELDS: ValidatableField[] = [{ name: "stars", type: "rating", max: 5 }];

describe("plugin field-type validation", () => {
  it("accepts a value the type approves", async () => {
    registerRating(() => true);

    expect(
      await validateEntryData({ stars: 3 }, FIELDS, { mode: "create" })
    ).toEqual([]);
  });

  it("reports a string return against the field", async () => {
    registerRating(() => "Must be a whole number of stars");

    const issues = await validateEntryData({ stars: 2.5 }, FIELDS, {
      mode: "create",
    });

    expect(issues).toEqual([
      {
        path: "stars",
        code: "CUSTOM",
        // The period is supplied: the message is rendered as-is by clients.
        message: "Must be a whole number of stars.",
      },
    ]);
  });

  it("reports every issue in an array return, each with its own path", async () => {
    // The reason the array shape exists: one structured value can be wrong in
    // several places, and collapsing that into one sentence throws away the
    // only thing the writer needs — where.
    registerRating(() => [
      { path: "stars.nodes[0]", code: "TOO_HIGH", message: "6 exceeds max 5" },
      { message: "Ratings must be whole numbers" },
    ]);

    const issues = await validateEntryData({ stars: 6 }, FIELDS, {
      mode: "create",
    });

    expect(issues).toEqual([
      {
        path: "stars.nodes[0]",
        code: "TOO_HIGH",
        message: "6 exceeds max 5.",
      },
      // Path and code fall back to the field's own, so a validator only
      // supplies them when it has something more precise to say.
      {
        path: "stars",
        code: "CUSTOM",
        message: "Ratings must be whole numbers.",
      },
    ]);
  });

  it("gives the validator the field instance, so it can read its own options", async () => {
    const seen = vi.fn(() => true as const);
    registerRating(seen);

    await validateEntryData({ stars: 3 }, FIELDS, { mode: "create" });

    expect(seen).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        field: expect.objectContaining({ type: "rating", max: 5 }),
        mode: "create",
        data: { stars: 3 },
      })
    );
  });

  it("hands over a copy of the field, not the schema being walked", async () => {
    registerRating((_value, args) => {
      (args.field as Record<string, unknown>).max = 999;
      return true;
    });

    await validateEntryData({ stars: 3 }, FIELDS, { mode: "create" });

    // A validator that edits what it was given must not change the schema the
    // rest of the pass is still reading.
    expect(FIELDS[0].max).toBe(5);
  });

  it("awaits an async validator", async () => {
    registerRating(async () => {
      await Promise.resolve();
      return "Checked against the service";
    });

    const issues = await validateEntryData({ stars: 3 }, FIELDS, {
      mode: "create",
    });

    expect(issues.map(i => i.message)).toEqual([
      "Checked against the service.",
    ]);
  });

  it("treats a throwing validator as a refusal, not a crash", async () => {
    registerRating(() => {
      throw new Error("registry unreachable");
    });

    const issues = await validateEntryData({ stars: 3 }, FIELDS, {
      mode: "create",
    });

    // A defective plugin must not turn a rejected write into a server error.
    expect(issues).toEqual([
      { path: "stars", code: "CUSTOM", message: "stars failed validation." },
    ]);
  });

  it("runs before the field's own validate, so a schema author composes on top", async () => {
    const order: string[] = [];
    registerRating(() => {
      order.push("type");
      return "Type rule";
    });

    const fields: ValidatableField[] = [
      {
        name: "stars",
        type: "rating",
        validate: () => {
          order.push("field");
          return "Field rule";
        },
      },
    ];

    const issues = await validateEntryData({ stars: 3 }, fields, {
      mode: "create",
    });

    expect(order).toEqual(["type", "field"]);
    // Both are reported: the field's rule adds to the type's rather than
    // replacing it.
    expect(issues.map(i => i.message)).toEqual(["Type rule.", "Field rule."]);
  });

  it("does not run for an absent value, which is what required is for", async () => {
    const seen = vi.fn(() => true as const);
    registerRating(seen);

    const issues = await validateEntryData(
      {},
      [{ name: "stars", type: "rating", required: true }],
      {
        mode: "create",
      }
    );

    expect(seen).not.toHaveBeenCalled();
    expect(issues.map(i => i.code)).toEqual(["REQUIRED"]);
  });

  it("leaves built-in types alone", async () => {
    // A plugin cannot redefine a built-in (the registry refuses), but the
    // dispatch must also not go looking for one on every field.
    const issues = await validateEntryData(
      { title: "ok" },
      [{ name: "title", type: "text" }],
      { mode: "create" }
    );

    expect(issues).toEqual([]);
  });
});
