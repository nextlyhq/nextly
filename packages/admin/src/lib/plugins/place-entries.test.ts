/**
 * Which document fields an edit page leaves to its tabs: those a tab drawn on
 * the page names in `fields`, and only where the document has all of them, so
 * a tab that is not drawn never takes a field out of the page's content.
 */
import type { DeliveredAdminEntry } from "nextly/config";
import { describe, expect, it } from "vitest";

import { fieldsTakenByTabs, fieldsWithheldHere } from "./place-entries";

function tab(id: string, fields?: string[]): DeliveredAdminEntry {
  return {
    plugin: "@acme/a",
    id,
    kind: "tab",
    label: id,
    component: "@acme/a/admin#Tab",
    ...(fields === undefined ? {} : { fields }),
  };
}

describe("the fields an edit page's tabs take over", () => {
  it("are the fields each fitting tab names", () => {
    expect([
      ...fieldsTakenByTabs(
        [tab("acme-a.seo", ["seo"]), tab("acme-a.notes", ["notes", "audit"])],
        ["title", "seo", "notes", "audit"]
      ),
    ]).toEqual(["seo", "notes", "audit"]);
  });

  it("leave a field where its tab is not drawn for want of another", () => {
    expect([
      ...fieldsTakenByTabs(
        [tab("acme-a.notes", ["notes", "audit"])],
        ["title", "notes"]
      ),
    ]).toEqual([]);
  });

  it("are none for a tab that edits no fields, or a built-in part", () => {
    expect([
      ...fieldsTakenByTabs([tab("acme-a.plain"), { builtIn: "x" }], ["title"]),
    ]).toEqual([]);
  });
});

describe("the fields a plugin's switch keeps off a page", () => {
  const withheld = {
    "collection:authors": ["seo"],
    "single:footer": ["seo", "notes"],
  };

  it("are the ones withheld on the collection the page shows", () => {
    expect(
      fieldsWithheldHere(withheld, { collection: "authors", entryId: "1" })
    ).toEqual(new Set(["seo"]));
  });

  it("are the ones withheld on the Single the page shows", () => {
    expect(fieldsWithheldHere(withheld, { single: "footer" })).toEqual(
      new Set(["seo", "notes"])
    );
  });

  it("are none on another type, or before the page knows its type", () => {
    expect(fieldsWithheldHere(withheld, { collection: "posts" })).toEqual(
      new Set()
    );
    expect(fieldsWithheldHere(withheld, null)).toEqual(new Set());
    expect(fieldsWithheldHere(undefined, { collection: "authors" })).toEqual(
      new Set()
    );
  });
});
