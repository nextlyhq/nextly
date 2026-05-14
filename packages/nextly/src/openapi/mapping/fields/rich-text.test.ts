import { describe, expect, it } from "vitest";

import type { RichTextFieldConfig } from "../../../collections/fields/types/rich-text";

import { mapRichTextField } from "./rich-text";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "Post",
  fieldPath: "fields[0]",
};

describe("mapRichTextField", () => {
  it("input is the opaque Lexical state object with editor hint", () => {
    const field: RichTextFieldConfig = { name: "body", type: "richText" };
    const { input } = mapRichTextField(field, baseCtx);
    expect(input).toMatchObject({
      type: "object",
      "x-nextly-richtext": { editor: "lexical" },
    });
  });

  it("output is the { html, json } envelope with both required", () => {
    const field: RichTextFieldConfig = { name: "body", type: "richText" };
    const { output } = mapRichTextField(field, baseCtx);
    expect(output).toMatchObject({
      type: "object",
      properties: {
        html: { type: "string" },
        json: expect.objectContaining({
          type: "object",
          "x-nextly-richtext": { editor: "lexical" },
        }) as unknown,
      },
      required: ["html", "json"],
    });
  });

  it("input and output are not the same object reference", () => {
    const field: RichTextFieldConfig = { name: "body", type: "richText" };
    const { input, output } = mapRichTextField(field, baseCtx);
    expect(input).not.toBe(output);
  });

  it("emits features into the x-nextly-richtext extension when set", () => {
    const field: RichTextFieldConfig = {
      name: "body",
      type: "richText",
      features: ["bold", "italic", "link", "h1", "h2"],
    };
    const { input, output } = mapRichTextField(field, baseCtx);
    expect((input as Record<string, unknown>)["x-nextly-richtext"]).toEqual({
      editor: "lexical",
      features: ["bold", "italic", "link", "h1", "h2"],
    });
    // Output's nested `json` schema also carries the same hint.
    const outputJson = (
      output as { properties?: { json?: Record<string, unknown> } }
    ).properties?.json;
    expect(outputJson?.["x-nextly-richtext"]).toEqual({
      editor: "lexical",
      features: ["bold", "italic", "link", "h1", "h2"],
    });
  });

  it("does NOT emit a features array when features is omitted", () => {
    const field: RichTextFieldConfig = { name: "body", type: "richText" };
    const { input } = mapRichTextField(field, baseCtx);
    const ext = (input as Record<string, unknown>)["x-nextly-richtext"] as
      | { features?: unknown }
      | undefined;
    expect(ext?.features).toBeUndefined();
  });

  it("does NOT emit features when features is an empty array (plain editor)", () => {
    // An explicit empty array means "plain editor, no formatting"; emit the
    // empty list verbatim so authors can communicate that intent.
    const field: RichTextFieldConfig = {
      name: "body",
      type: "richText",
      features: [],
    };
    const { input } = mapRichTextField(field, baseCtx);
    const ext = (input as Record<string, unknown>)["x-nextly-richtext"] as {
      features?: readonly string[];
    };
    expect(ext.features).toEqual([]);
  });

  it("admin.description wins, label is the fallback", () => {
    const a: RichTextFieldConfig = {
      name: "body",
      type: "richText",
      label: "Body",
      admin: { description: "Full article body." },
    };
    const b: RichTextFieldConfig = {
      name: "body",
      type: "richText",
      label: "Body",
    };
    expect(mapRichTextField(a, baseCtx).input.description).toBe(
      "Full article body."
    );
    expect(mapRichTextField(b, baseCtx).input.description).toBe("Body");
    expect(mapRichTextField(a, baseCtx).output.description).toBe(
      "Full article body."
    );
  });
});
