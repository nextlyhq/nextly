import { describe, expect, it } from "vitest";

import {
  documentLabel,
  labelFieldsFor,
  selectFieldsFor,
  selectParam,
  selectionKey,
  groupChoices,
} from "./RedirectPagePicker";

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

describe("groupChoices", () => {
  const choice = (collection: string, id: string) => ({
    collection,
    id,
    label: id,
  });

  it("orders groups by configuration", () => {
    const groups = groupChoices(
      [choice("posts", "p1"), choice("pages", "g1")],
      ["pages", "posts"]
    );
    expect(groups.map(g => g.collection)).toEqual(["pages", "posts"]);
    expect(groups.every(g => !g.removed)).toBe(true);
  });

  it("keeps a collection that is no longer configured, marked and last", () => {
    // The case that made the control blank: a stored target is recovered by
    // id, and filtering the render by configuration dropped it — over a value
    // that is still saved, with the unreadable warning cleared because the
    // recovery had succeeded.
    const groups = groupChoices(
      [choice("pages", "g1"), choice("retired", "r1")],
      ["pages", "posts"]
    );
    expect(groups.map(g => g.collection)).toEqual(["pages", "retired"]);
    expect(groups[1].removed).toBe(true);
    expect(groups[1].label).toContain("no longer configured");
  });

  it("keeps the stored target when NO collection is configured", () => {
    // The zero-config case specifically. The previous test kept another
    // configured collection, so it exercised the grouping but never this — and
    // this is the state where the picker is the only thing that can tell an
    // author which page is still saved.
    const groups = groupChoices([choice("retired", "r1")], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].collection).toBe("retired");
    expect(groups[0].removed).toBe(true);
    expect(groups[0].choices).toHaveLength(1);
  });

  it("does not invent a group for a configured collection with no choices", () => {
    expect(
      groupChoices([choice("pages", "g1")], ["pages", "posts"]).map(
        g => g.collection
      )
    ).toEqual(["pages"]);
  });

  it("puts every choice in exactly one group", () => {
    const choices = [
      choice("pages", "a"),
      choice("pages", "b"),
      choice("x", "c"),
    ];
    const groups = groupChoices(choices, ["pages"]);
    expect(groups.flatMap(g => g.choices)).toHaveLength(choices.length);
  });
});

describe("labelFieldsFor", () => {
  it("leads with the field the collection says names its documents", () => {
    // A collection whose `admin.useAsTitle` is `headline` is listed by its
    // headlines. Without this the control neither requests nor inspects that
    // field, so every row falls through to its id and an author picking a
    // redirect target chooses between opaque strings.
    expect(labelFieldsFor("headline")).toEqual([
      "id",
      "headline",
      "title",
      "name",
      "label",
      "slug",
    ]);
  });

  it("does not list a configured field twice", () => {
    // `useAsTitle: "title"` is the ordinary case. A duplicate would be
    // harmless in the projection and misleading in the order.
    expect(labelFieldsFor("title")).toEqual([
      "id",
      "title",
      "name",
      "label",
      "slug",
    ]);
  });

  it("keeps the conventional names behind the configured one", () => {
    // So a row whose configured title field is empty still reads as something
    // recognisable rather than as an id.
    expect(labelFieldsFor("headline")).toContain("slug");
  });

  it("falls back to the conventional names when nothing is configured", () => {
    // Undefined covers "declares no title field" and "metadata unreadable"
    // alike; the control does the same thing for both.
    for (const unset of [undefined, "", "   "]) {
      expect(labelFieldsFor(unset)).toEqual([
        "id",
        "title",
        "name",
        "label",
        "slug",
      ]);
    }
  });

  it("always asks for the id, because the control stores it", () => {
    expect(labelFieldsFor("headline")[0]).toBe("id");
    expect(labelFieldsFor(undefined)[0]).toBe("id");
  });
});

describe("selectParam", () => {
  /**
   * The server's own acceptance rule, mirrored.
   *
   * `parseSelectParam` (packages/nextly/src/dispatcher/helpers/validation.ts)
   * reads the parameter with `JSON.parse` and keeps only the keys whose values
   * are booleans. A value it cannot parse becomes `undefined` — no error, no
   * warning, and a response carrying every field of every row. That silence is
   * why this needs asserting: a projection that is ignored looks exactly like
   * a projection that worked, from the client's side.
   */
  const asServerReads = (
    param: string
  ): Record<string, boolean> | undefined => {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(param));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return undefined;
      const map: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "boolean") map[key] = value;
      }
      return Object.keys(map).length > 0 ? map : undefined;
    } catch {
      return undefined;
    }
  };

  it("emits a projection the server applies", () => {
    expect(asServerReads(selectParam(["id", "headline"]))).toEqual({
      id: true,
      headline: true,
    });
  });

  it("projects every field it was given, and no others", () => {
    const fields = labelFieldsFor("headline");
    expect(
      Object.keys(asServerReads(selectParam(fields)) ?? {}).sort()
    ).toEqual([...fields].sort());
  });

  it("survives being embedded in a query string", () => {
    // The value is interpolated into a URL beside `limit`, `page` and
    // `search`; an unescaped `{`, `"` or `&` would truncate it there.
    const url = new URL(
      `https://example.test/e?limit=50&select=${selectParam(["id", "title"])}&search=x`
    );
    expect(asServerReads(url.searchParams.get("select") ?? "")).toEqual({
      id: true,
      title: true,
    });
    expect(url.searchParams.get("search")).toBe("x");
  });

  it("is not the comma-separated list this control shipped with", () => {
    // The regression itself. `JSON.parse("id,title,name")` throws, the server
    // returns `undefined`, and every scalar and JSON field of up to fifty
    // documents per collection is downloaded to fill a dropdown — for
    // page-builder documents, the whole block tree.
    expect(asServerReads("id,title,name,label,slug")).toBeUndefined();
    expect(asServerReads(selectParam(["id", "title"]))).toBeDefined();
  });
});

describe("documentLabel with a collection's own title field", () => {
  it("prefers the configured field over the conventional ones", () => {
    expect(
      documentLabel(
        { id: "1", headline: "Launch day", title: "untitled" },
        labelFieldsFor("headline")
      )
    ).toBe("Launch day");
  });

  it("falls through to a conventional field when the configured one is blank", () => {
    expect(
      documentLabel(
        { id: "1", headline: "   ", title: "Launch day" },
        labelFieldsFor("headline")
      )
    ).toBe("Launch day");
  });

  it("still reaches the id, then the placeholder, with a configured field", () => {
    // The configured field does not displace the last resorts: a row carrying
    // none of the title fields is still an option an author can see.
    expect(documentLabel({ id: "pg1" }, labelFieldsFor("headline"))).toBe(
      "pg1"
    );
    expect(documentLabel({}, labelFieldsFor("headline"))).toBe("Untitled");
  });
});

describe("selectFieldsFor", () => {
  it("requests the status, so a draft can be marked as one", () => {
    expect(selectFieldsFor("headline")).toContain("status");
  });

  it("requests what says the collection has a lifecycle at all", () => {
    // Without `firstPublishedAt` every row comes back looking unmanaged, and
    // an unmanaged row is always reachable — so the projection alone would
    // silently disable every Draft marker.
    expect(selectFieldsFor("headline")).toContain("firstPublishedAt");
  });

  it("requests everything the label needs", () => {
    // Derived from the label list rather than written out again: a field added
    // for labelling that is never requested comes back absent, and the label
    // falls silently to the id.
    for (const field of labelFieldsFor("headline")) {
      expect(selectFieldsFor("headline")).toContain(field);
    }
  });

  it("never lets the status become a document's name", () => {
    // `documentLabel` walks whatever list it is handed, in order. If `status`
    // were a label field, a page with no title would be offered to an author
    // as "draft" — which reads as a page called Draft.
    expect(labelFieldsFor("headline")).not.toContain("status");
    expect(labelFieldsFor(undefined)).not.toContain("status");
    expect(documentLabel({ id: "1", status: "draft" }, labelFieldsFor())).toBe(
      "1"
    );
  });
});
