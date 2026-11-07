/**
 * A condition as the "Show when" controls word it, the operators each kind
 * of field offers, and a draft row as the condition it would store.
 */
import { CONDITION_KIND_OPS } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  completedCondition,
  conditionChoices,
  conditionFieldsOf,
  conditionLine,
  conditionSentence,
  valueOpFor,
} from "./condition-model";
import type { QueryField } from "./list-query-model";

const rating: QueryField = {
  name: "rating",
  label: "Reading time",
  kind: "number",
};
const published: QueryField = { name: "at", label: "Published", kind: "date" };
const featured: QueryField = {
  name: "featured",
  label: "Featured",
  kind: "boolean",
};
const title: QueryField = { name: "title", label: "Title", kind: "text" };

describe("the operators a field offers", () => {
  it("offers exactly the engine's operators for each kind but yes-or-no", () => {
    for (const kind of ["text", "number", "date", "choice", "entry"] as const) {
      expect(conditionChoices(kind).map(choice => choice.op)).toEqual(
        CONDITION_KIND_OPS[kind]
      );
    }
  });

  it("offers a yes-or-no field one choice, its Yes or No stored as the operator", () => {
    expect(conditionChoices("boolean")).toEqual([
      { key: "is", op: "is_true", label: "is" },
    ]);
    expect(valueOpFor("is_false")).toBe("equals");
  });

  it("words a date's order as days, as a list's filter does", () => {
    expect(conditionChoices("date").map(choice => choice.label)).toEqual([
      "is after",
      "is before",
      "has a value",
      "is empty",
    ]);
  });
});

describe("a condition as one sentence", () => {
  it("reads as field, operator and value", () => {
    expect(
      conditionLine(
        conditionSentence(
          { field: "rating", op: "greater_than", value: 5 },
          rating
        )
      )
    ).toBe("Reading time is more than 5");
    expect(
      conditionLine(
        conditionSentence(
          { field: "title", op: "not_contains", value: "draft" },
          title
        )
      )
    ).toBe("Title doesn’t contain “draft”");
    expect(
      conditionLine(
        conditionSentence({ field: "featured", op: "is_false" }, featured)
      )
    ).toBe("Featured is No");
    expect(
      conditionLine(conditionSentence({ field: "at", op: "exists" }, published))
    ).toBe("Published has a value");
  });

  it("names a field the controls don't offer, as stored, its operator in words", () => {
    expect(
      conditionLine(
        conditionSentence({ field: "secret", op: "exists" }, undefined)
      )
    ).toBe("secret (not offered here) has a value");
  });
});

describe("a draft row as the condition it would store", () => {
  it("asks for what is missing, in words", () => {
    expect(completedCondition({}, undefined)).toEqual({
      missing: "Choose a field, or remove this condition.",
    });
    expect(
      completedCondition({ field: "rating", op: "greater_than" }, rating)
    ).toEqual({
      missing: "Choose a value for Reading time, or remove this condition.",
    });
  });

  it("stores an operator that takes no value without one", () => {
    expect(
      completedCondition(
        { field: "at", op: "not_exists", value: "x" },
        published
      )
    ).toEqual({ condition: { field: "at", op: "not_exists" } });
  });

  it("stores a compared value as chosen", () => {
    expect(
      completedCondition({ field: "rating", op: "less_than", value: 3 }, rating)
    ).toEqual({ condition: { field: "rating", op: "less_than", value: 3 } });
  });
});

describe("the fields a condition can check", () => {
  it("adds every readable field no list filters by, asked only whether it has a value", () => {
    const fields = conditionFieldsOf({
      slug: "posts",
      label: "Posts",
      fields: [{ name: "title", label: "Title", kind: "text" }],
      readable: [
        { name: "id", label: "ID", type: "text" },
        { name: "title", label: "Title", type: "text" },
        {
          name: "tags",
          label: "Tags",
          type: "relationship",
          relationTo: "tags",
          hasMany: true,
        },
        { name: "cover", type: "upload", relationTo: "media" },
        { name: "opensAt", label: "Opens at", type: "date", timeOnly: true },
      ],
    });
    expect(
      fields.map(field => [field.name, field.kind, field.kindWords])
    ).toEqual([
      ["title", "text", undefined],
      // A scalar no list offers keeps its own kind and operators.
      ["id", "text", undefined],
      ["tags", "other", "Several entries"],
      ["cover", "other", "Media"],
      ["opensAt", "other", "Time of day"],
    ]);
    // Named by its name when no label came with it.
    expect(fields[3]?.label).toBe("cover");
    expect(conditionChoices("other").map(choice => choice.op)).toEqual([
      "exists",
      "not_exists",
    ]);
  });

  it("lists a yes-or-no field's stored equals No as it stands, beside is", () => {
    expect(
      conditionChoices("boolean", "equals").map(choice => choice.label)
    ).toEqual(["is", "is set to"]);
    // CONTROL: nothing is added for the operators "is" stands for.
    expect(conditionChoices("boolean", "is_false")).toHaveLength(1);
  });
});

describe("a number too large to hold", () => {
  it("is not a finished condition, so it is never written", () => {
    expect(
      completedCondition(
        { field: "rating", op: "greater_than", value: Infinity },
        rating
      )
    ).toEqual({
      missing:
        "Enter a smaller number for Reading time, or remove this condition.",
    });
    // CONTROL: a finite one is.
    expect(
      completedCondition(
        { field: "rating", op: "greater_than", value: 5 },
        rating
      )
    ).toEqual({
      condition: { field: "rating", op: "greater_than", value: 5 },
    });
  });
});

describe("empty text", () => {
  it("is a value text equality compares with, and nothing else takes", () => {
    expect(
      completedCondition({ field: "title", op: "equals", value: "" }, title)
    ).toEqual({ condition: { field: "title", op: "equals", value: "" } });
    // CONTROL: contains needs text to look for, as the save says.
    expect(
      "missing" in
        completedCondition({ field: "title", op: "contains", value: "" }, title)
    ).toBe(true);
  });
});
