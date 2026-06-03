import { describe, expect, it } from "vitest";

import { componentToManifestEntity } from "../to-manifest-entity-component";
import { singleToManifestEntity } from "../to-manifest-entity-single";

describe("singleToManifestEntity", () => {
  it("maps slug + fields into a manifest entity", () => {
    const e = singleToManifestEntity({
      slug: "hero",
      settings: { singularName: "Hero" },
      fields: [{ name: "heading", type: "text", required: true }],
    });
    expect(e.slug).toBe("hero");
    expect(e.fields).toEqual([
      { name: "heading", type: "text", required: true },
    ]);
  });

  it("accepts the widened types (radio with options)", () => {
    const e = singleToManifestEntity({
      slug: "hero",
      settings: {},
      fields: [
        { name: "size", type: "radio", options: [{ label: "S", value: "s" }] },
      ],
    });
    expect(e.fields[0].type).toBe("radio");
    expect(e.fields[0].options).toEqual([{ label: "S", value: "s" }]);
  });

  it("maps nested fields for a repeater", () => {
    const e = singleToManifestEntity({
      slug: "hero",
      settings: {},
      fields: [
        {
          name: "items",
          type: "repeater",
          fields: [{ name: "label", type: "text" }],
        },
      ],
    });
    expect(e.fields[0].fields).toEqual([{ name: "label", type: "text" }]);
  });
});

describe("componentToManifestEntity", () => {
  it("maps slug + fields into a manifest entity", () => {
    const e = componentToManifestEntity({
      slug: "card",
      settings: { singularName: "Card" },
      fields: [{ name: "title", type: "text" }],
    });
    expect(e.slug).toBe("card");
    expect(e.fields).toEqual([{ name: "title", type: "text" }]);
  });
});
