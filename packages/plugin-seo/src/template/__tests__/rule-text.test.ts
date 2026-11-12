/**
 * A template's rule as a person writes it, `{Post title} | Acme`, and as the
 * Page Builder stores it, text and bindings joined in order: each read as the
 * other, the site's name bound to the site's own, and a variable naming no
 * field said to be one.
 */
import { describe, expect, it } from "vitest";

import { ruleOfText, textOfRule } from "../rule-text";

const FIELDS = [
  { name: "title", token: "Post title" },
  { name: "excerpt", token: "Post excerpt" },
];

describe("a template's rule, written as text", () => {
  it("binds each variable to its field and the site's name to the site's", () => {
    expect(ruleOfText("{Post title} | {Site name}", FIELDS)).toEqual({
      segments: [
        { $bind: "title" },
        " | ",
        { $bind: "applicationName", source: "site" },
      ],
      unknown: [],
    });
  });

  it("matches a variable however it is spaced or cased", () => {
    expect(ruleOfText("Read {post TITLE}", FIELDS).segments).toEqual([
      "Read ",
      { $bind: "title" },
    ]);
  });

  it("keeps a variable naming no field as written, and names it", () => {
    expect(ruleOfText("{Author} wrote this", FIELDS)).toEqual({
      segments: ["{Author} wrote this"],
      unknown: ["Author"],
    });
  });

  it("is nothing for empty text", () => {
    expect(ruleOfText("   ", FIELDS).segments).toEqual([]);
  });
});

describe("a stored rule, read as text", () => {
  it("names each binding by its field's variable, and the site's name", () => {
    expect(
      textOfRule(
        [
          { $bind: "title" },
          " | ",
          { $bind: "applicationName", source: "site" },
        ],
        FIELDS
      )
    ).toEqual({ text: "{Post title} | {Site name}", exact: true });
  });

  it("says where a binding is one the text cannot write, and names its path", () => {
    expect(textOfRule([{ $bind: "author.name" }, " wrote"], FIELDS)).toEqual({
      text: "{author.name} wrote",
      exact: false,
    });
  });

  it("says a binding with a fallback is more than its variable", () => {
    expect(
      textOfRule([{ $bind: "title", fallback: { value: "x" } }], FIELDS)
    ).toEqual({ text: "{Post title}", exact: false });
  });

  it("reads back what it wrote", () => {
    const written = "{Post excerpt} — {Post title} | {Site name}";
    expect(textOfRule(ruleOfText(written, FIELDS).segments, FIELDS).text).toBe(
      written
    );
  });
});
