/**
 * What an entry is called, asked by three surfaces that must agree.
 *
 * The entry list picks a primary COLUMN, the editor heading and the version
 * comparison heading each need TEXT. Answering with different preference lists
 * let a document be called one thing by its editor and another by the page
 * comparing its versions — and a reader cannot tell whether such a difference
 * means something.
 */
import { describe, it, expect } from "vitest";

import {
  COMMON_TITLE_FIELDS,
  entryTitleField,
  entryTitleValue,
} from "../entry-title";

describe("entryTitleField — which field names an entry", () => {
  it("takes the author's nomination first", () => {
    expect(entryTitleField("headline", ["headline", "title"])).toBe("headline");
  });

  /**
   * The case that exposed the divergence: a collection whose fields are
   * `[description, subject]` and which nominates nothing. One rule reached for
   * the FIRST field, `description`, while the other knew `subject` is
   * conventionally a title — so the two named the same document differently.
   */
  it("prefers a conventional field over merely the first one", () => {
    expect(entryTitleField(undefined, ["description", "subject"])).toBe(
      "subject"
    );
  });

  it("follows the preference order rather than the field order", () => {
    // `name` outranks `subject` wherever both exist, whichever comes first in
    // the schema — otherwise the answer depends on how the author happened to
    // arrange the collection.
    expect(entryTitleField(undefined, ["subject", "name"])).toBe("name");
    expect(entryTitleField(undefined, ["name", "subject"])).toBe("name");
  });

  /**
   * `undefined` rather than a guess, so a caller can tell "nothing here is
   * conventionally a title" from "the title is empty" and answer each in the
   * way its own surface needs.
   */
  it("says nothing when no field is conventional", () => {
    expect(entryTitleField(undefined, ["description", "body"])).toBeUndefined();
  });

  it("ignores a nomination that is absent, or is `id`", () => {
    // A nominated field that is not in the schema cannot be read, and `id` is
    // what the fallbacks already show — treating it as a title would hide a
    // real title field behind it.
    expect(entryTitleField("missing", ["title"])).toBe("title");
    expect(entryTitleField("id", ["title"])).toBe("title");
  });
});

describe("entryTitleValue — what to call this entry", () => {
  it("takes the nominated field's value", () => {
    expect(
      entryTitleValue({ headline: "Ada writes a compiler" }, "headline")
    ).toBe("Ada writes a compiler");
  });

  /**
   * The nominated field being EMPTY is not the end of the search. An entry with
   * a blank title and a filled `name` has a better name available, and showing
   * the caller's fallback there would be worse than showing it.
   */
  it("keeps looking when the nominated field is blank", () => {
    expect(entryTitleValue({ headline: "   ", name: "Ada" }, "headline")).toBe(
      "Ada"
    );
  });

  it("follows the same order as the field choice", () => {
    expect(entryTitleValue({ subject: "Re: hello", name: "Ada" })).toBe("Ada");
  });

  /**
   * A number IS a name where an author chose one. An invoice or issue number
   * is what such an entry is called, the entry table already shows that
   * column, and the translation worklist already converts it — so refusing it
   * here would name one entry three different ways.
   */
  it("keeps a numeric title", () => {
    expect(entryTitleValue({ invoiceNo: 42 }, "invoiceNo")).toBe("42");
    expect(entryTitleValue({ title: 0, name: "Ada" })).toBe("0");
  });

  it("refuses values a reader would not recognise as a name", () => {
    // Objects and arrays stringify to `[object Object]` and to their contents;
    // neither is a name. `NaN` and `Infinity` are numbers that are not.
    expect(entryTitleValue({ title: {}, name: "Ada" })).toBe("Ada");
    expect(entryTitleValue({ title: [1, 2], name: "Ada" })).toBe("Ada");
    expect(entryTitleValue({ title: NaN, name: "Ada" })).toBe("Ada");
    expect(entryTitleValue({ title: "" })).toBeUndefined();
  });

  it("says nothing for an entry that says nothing about itself", () => {
    expect(entryTitleValue({ body: "text" })).toBeUndefined();
    expect(entryTitleValue(undefined, "title")).toBeUndefined();
  });
});

describe("the two answers agree", () => {
  /**
   * The property the whole module exists for. Whichever field the column
   * choice lands on, reading that field's value must produce the same title —
   * otherwise the list and the heading name one document two ways, which is
   * exactly the divergence this replaced.
   */
  it("names the same field the value comes from", () => {
    const fieldNames = ["description", "subject", "name"];
    const chosen = entryTitleField(undefined, fieldNames);
    expect(chosen).toBeDefined();

    const entry = {
      description: "long text",
      subject: "Re: hello",
      name: "Ada",
    };
    expect(entryTitleValue(entry, undefined)).toBe(
      entry[chosen as keyof typeof entry]
    );
  });

  /** The order is one list, not two copies that happen to match today. */
  it("uses one preference order", () => {
    expect(COMMON_TITLE_FIELDS).toEqual([
      "title",
      "name",
      "label",
      "subject",
      "heading",
    ]);
  });
});
