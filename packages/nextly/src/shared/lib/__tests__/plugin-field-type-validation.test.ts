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
  withoutDisabledBehavior,
} from "../../../domains/schema/field-types/field-type-registry";
import type {
  PluginFieldType,
  PluginFieldValidateArgs,
  PluginFieldValidationResult,
} from "../../../plugins/contributions";
import { validateEntryData, type ValidatableField } from "../entry-validation";

afterEach(() => {
  clearFieldTypes();
});

type Validator = (
  value: unknown,
  args: PluginFieldValidateArgs
) => PluginFieldValidationResult | Promise<PluginFieldValidationResult>;

/** Register a custom type whose validate returns whatever the test wants. */
function registerRating(validate: Validator): void {
  registerFieldType({
    type: "rating",
    storage: "number",
    component: "@acme/ratings/admin#RatingInput",
    validate,
  });
}

/** A `json`-backed type: its primitive imposes no rules, so validate is all it has. */
function registerDocument(validate: Validator): void {
  registerFieldType({
    type: "document",
    storage: "json",
    component: "@acme/docs/admin#DocumentInput",
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
    registerDocument((_value, { path }) => [
      {
        path: `${path}.nodes[0]`,
        code: "DISALLOWED",
        message: "Not allowed here",
      },
      { message: "Document exceeds the node limit" },
    ]);

    const issues = await validateEntryData(
      { body: { nodes: [] } },
      [{ name: "body", type: "document" }],
      { mode: "create" }
    );

    expect(issues).toEqual([
      {
        path: "body.nodes[0]",
        code: "DISALLOWED",
        message: "Not allowed here.",
      },
      // Path and code fall back to the field's own, so a validator only
      // supplies them when it has something more precise to say.
      {
        path: "body",
        code: "CUSTOM",
        message: "Document exceeds the node limit.",
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

  it("checks the value against the storage primitive the type declares", async () => {
    // The switch over built-in types never sees "rating", so without the
    // storage primitive standing in for it a number-backed type would accept
    // any string at all on its way to a numeric column.
    registerRating(() => true);

    const issues = await validateEntryData({ stars: "3" }, FIELDS, {
      mode: "create",
    });

    expect(issues).toEqual([
      {
        path: "stars",
        code: "INVALID_TYPE",
        message: "stars must be a number.",
      },
    ]);
  });

  it("applies the primitive's own rules from the field's options", async () => {
    registerRating(() => true);

    const issues = await validateEntryData({ stars: 9 }, FIELDS, {
      mode: "create",
    });

    expect(issues.map(i => i.code)).toEqual(["TOO_HIGH"]);
  });

  it("does not run the type's validate on a value the primitive refused", async () => {
    // A validator reasons about ratings, not about whether it was handed a
    // string, so it is never asked about a value of the wrong shape.
    const seen = vi.fn(() => true as const);
    registerRating(seen);

    await validateEntryData({ stars: "3" }, FIELDS, { mode: "create" });

    expect(seen).not.toHaveBeenCalled();
  });

  it("refuses a return value outside the documented union", async () => {
    // A validator that forgets to return yields undefined. Reading that as
    // consent would turn one plugin bug into no validation at all.
    registerRating((() => undefined) as unknown as Validator);

    const issues = await validateEntryData({ stars: 3 }, FIELDS, {
      mode: "create",
    });

    expect(issues).toEqual([
      { path: "stars", code: "CUSTOM", message: "stars failed validation." },
    ]);
  });

  it("gives a nested instance the whole write and its own path", async () => {
    // The recursive pass walks each repeater row, so the row is what a nested
    // field is checked against — but a cross-field rule needs the top-level
    // siblings, which the row does not carry.
    const seen = vi.fn(() => true as const);
    registerRating(seen);

    const fields: ValidatableField[] = [
      { name: "title", type: "text" },
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "stars", type: "rating" }],
      },
    ];

    await validateEntryData(
      { title: "Reviews", rows: [{ stars: 1 }, { stars: 2 }] },
      fields,
      { mode: "create" }
    );

    expect(seen).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({
        data: { title: "Reviews", rows: [{ stars: 1 }, { stars: 2 }] },
        path: "rows[1].stars",
      })
    );
  });

  it("detaches nested options, not just the field's own keys", async () => {
    const allow = ["hero", "cta"];
    registerDocument((_value, args) => {
      const blocks = args.field.blocks;
      if (blocks !== null && typeof blocks === "object") {
        (blocks as { allow: string[] }).allow.push("injected");
      }
      return true;
    });

    const fields: ValidatableField[] = [
      { name: "body", type: "document", blocks: { allow } },
    ];
    await validateEntryData({ body: {} }, fields, { mode: "create" });

    // A shallow copy would have left this array shared with the schema, so one
    // validator run would have changed what every later write is checked
    // against.
    expect(allow).toEqual(["hero", "cta"]);
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

describe("a disabled plugin's field type", () => {
  const rating: PluginFieldType = {
    type: "rating",
    storage: "number",
    component: "@acme/ratings/admin#RatingInput",
    validate: () => "this must never run",
  };

  it("keeps its declarative schema but loses its validate", () => {
    const registrable = withoutDisabledBehavior(rating, { enabled: false });

    expect(registrable.validate).toBeUndefined();
    // The plugin's collections are retained while it is off, so their fields
    // still have to map to a column and render.
    expect(registrable.storage).toBe("number");
    expect(registrable.component).toBe("@acme/ratings/admin#RatingInput");
  });

  it("is untouched while the plugin is enabled", () => {
    expect(withoutDisabledBehavior(rating, {}).validate).toBe(rating.validate);
    expect(withoutDisabledBehavior(rating, { enabled: true }).validate).toBe(
      rating.validate
    );
  });

  it("does not run on a write once registered", async () => {
    registerFieldType(withoutDisabledBehavior(rating, { enabled: false }));

    const issues = await validateEntryData({ stars: 3 }, FIELDS, {
      mode: "create",
    });

    expect(issues).toEqual([]);
  });
});
