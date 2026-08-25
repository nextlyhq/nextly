import { describe, expect, it } from "vitest";

import { documentLabel, selectionKey } from "./RedirectPagePicker";

describe("selectionKey", () => {
  const many = ["pages", "posts"];

  it("reads the shape the picker itself writes", () => {
    expect(selectionKey({ relationTo: "posts", value: "p1" }, many)).toBe(
      "posts:p1"
    );
  });

  it("reads a value populated by a read at depth", () => {
    // A form saved and reloaded serves the row under `value`; showing the
    // control blank there would invite an author to re-pick what is already
    // set, and saving blank is a different document than the one stored.
    expect(
      selectionKey({ relationTo: "pages", value: { id: "pg1" } }, many)
    ).toBe("pages:pg1");
  });

  it("reads a bare id only when one collection is configured", () => {
    expect(selectionKey("pg1", ["pages"])).toBe("pages:pg1");
    expect(selectionKey("pg1", many)).toBeUndefined();
  });

  it("shows nothing for an unset or unreadable value", () => {
    for (const empty of [null, undefined, "", [], { relationTo: "pages" }]) {
      expect(selectionKey(empty, many)).toBeUndefined();
    }
  });
});

describe("documentLabel", () => {
  it("prefers the field an author would recognise", () => {
    expect(documentLabel({ id: "1", title: "About", slug: "about" })).toBe(
      "About"
    );
    expect(documentLabel({ id: "1", name: "Contact" })).toBe("Contact");
    expect(documentLabel({ id: "1", slug: "pricing" })).toBe("pricing");
  });

  it("skips a blank field rather than showing an empty row", () => {
    expect(documentLabel({ id: "1", title: "   ", slug: "about" })).toBe(
      "about"
    );
  });

  it("falls back to the id, then to a placeholder", () => {
    expect(documentLabel({ id: "pg1" })).toBe("pg1");
    expect(documentLabel({})).toBe("Untitled");
  });
});
