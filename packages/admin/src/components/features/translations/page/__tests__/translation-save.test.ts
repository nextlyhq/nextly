/**
 * A save of one language sends the fields the translator changed and nothing
 * else: a field sent unchanged is recorded as made again from its source, which
 * would clear an out-of-date mark nobody looked at, and a shared field would
 * change every other language.
 */
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import type { TranslationField } from "../translation-fields";
import { changedRows, translationPayload } from "../translation-save";

const row = (name: string, type = "text"): TranslationField => ({
  field: { name, type } as unknown as FieldConfig,
  name,
  label: name,
});

const ROWS = [row("title"), row("body"), row("related", "relationship")];
const STARTED = { title: "Hola", body: "", related: ["a"], price: 3 };
const FROM_ENGLISH = () => "en";

const payload = (
  values: Record<string, unknown>,
  sourceOf: (name: string) => string | undefined = FROM_ENGLISH
) => translationPayload(ROWS, { ...STARTED, ...values }, STARTED, sourceOf);

describe("translationPayload", () => {
  it("sends a changed field alone", () => {
    expect(payload({ title: "Buenas" })).toEqual({ title: "Buenas" });
  });

  it("sends nothing where nothing changed", () => {
    expect(payload({})).toEqual({});
    // An empty field left empty, however the form spells empty.
    expect(payload({ body: null })).toEqual({});
  });

  it("never sends a shared field, changed or not", () => {
    expect(payload({ price: 9 })).toEqual({});
    expect(payload({ price: 9, title: "Buenas" })).toEqual({ title: "Buenas" });
  });

  it("stores an emptied field as no value", () => {
    expect(payload({ title: "" })).toEqual({ title: null });
  });

  it("reads a link drawn as the document it names as the same link", () => {
    expect(payload({ related: [{ id: "a", title: "A" }] })).toEqual({});
    expect(payload({ related: [{ id: "b" }] })).toEqual({
      related: [{ id: "b" }],
    });
  });

  it("claims as original only what has no source", () => {
    expect(
      payload({ title: "Buenas", body: "Texto" }, name =>
        name === "title" ? "en" : undefined
      )
    ).toEqual({
      title: "Buenas",
      body: "Texto",
      _provenance: { body: { origin: "original" } },
    });
  });

  it("claims nothing for a value from any language's text", () => {
    // Whose words they are is a person's; the server records the source.
    expect(payload({ title: "Buenas" }, () => "fr")).toEqual({
      title: "Buenas",
    });
  });

  it("claims nothing for a field that was emptied", () => {
    expect(payload({ title: "  " }, () => undefined)).toEqual({ title: "  " });
    expect(payload({ title: "" }, () => undefined)).toEqual({ title: null });
  });
});

describe("changedRows", () => {
  it("names the changed rows in their own order", () => {
    expect(
      changedRows(
        ROWS,
        { ...STARTED, body: "Texto", title: "Buenas" },
        STARTED
      ).map(each => each.name)
    ).toEqual(["title", "body"]);
  });
});
