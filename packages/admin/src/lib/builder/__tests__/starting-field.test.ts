import type { FieldTypeCatalogEntry } from "nextly/field-catalog";
import { describe, expect, it } from "vitest";

import {
  hasStartingFieldChoice,
  startingFieldChoices,
  startingFieldName,
  startingFields,
} from "../starting-field";

const entry = (type: string, label: string): FieldTypeCatalogEntry<string> =>
  ({
    type,
    label,
    hint: `${label} hint`,
    category: "Structured",
    icon: "LayoutGrid",
  }) as FieldTypeCatalogEntry<string>;

describe("startingFieldChoices", () => {
  it("offers the default first, so it is what an unengaged create gets", () => {
    const [first] = startingFieldChoices([entry("blocks", "Blocks")]);
    expect(first.type).toBeNull();
  });

  it("offers a choice for each plugin field type, by MEMBERSHIP", () => {
    const choices = startingFieldChoices([
      entry("blocks", "Blocks"),
      entry("acme/canvas", "Canvas"),
    ]);
    // Asserted by the types present rather than by a count: a derivation that
    // dropped one and duplicated another matches any total.
    expect(choices.map(c => c.type)).toEqual([null, "blocks", "acme/canvas"]);
  });

  it("names nothing itself — the labels come from the plugins", () => {
    const [, blocks] = startingFieldChoices([entry("blocks", "Page Builder")]);
    expect(blocks.label).toBe("Page Builder");
  });
});

describe("hasStartingFieldChoice", () => {
  it("is false when no plugin contributes one", () => {
    // One option is not a choice. This is what tells a surface to render
    // nothing rather than a control with a single answer.
    expect(hasStartingFieldChoice(startingFieldChoices([]))).toBe(false);
  });

  it("is true once there is something to compare the default against", () => {
    expect(
      hasStartingFieldChoice(startingFieldChoices([entry("blocks", "Blocks")]))
    ).toBe(true);
  });
});

describe("startingFields", () => {
  it("seeds nothing for the default", () => {
    // The create call already sent an empty list, and the server injects the
    // system columns either way, so this is a complete answer not a missing one.
    expect(startingFields(null)).toEqual([]);
  });

  it("seeds exactly one field of the chosen type", () => {
    expect(startingFields("blocks")).toEqual([
      { name: "blocks", type: "blocks" },
    ]);
  });
});

describe("startingFieldName", () => {
  it("uses the last segment of a namespaced type", () => {
    // A plugin type id may be namespaced, and `acme/canvas` is not a column
    // name — the API would reject it naming neither the field nor the choice.
    expect(startingFieldName("acme/canvas")).toBe("canvas");
  });

  it("drops characters a column name cannot carry", () => {
    expect(startingFieldName("Rich-Text Blocks")).toBe("rich_text_blocks");
  });

  it("falls back rather than producing an empty name", () => {
    // A type made entirely of separators reduces to nothing, and an empty name
    // fails at the API rather than here.
    expect(startingFieldName("///")).toBe("content");
    expect(startingFieldName("---")).toBe("content");
  });
});
