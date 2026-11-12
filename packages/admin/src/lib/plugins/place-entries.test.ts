/**
 * Which document fields an edit page leaves to its tabs: those a tab drawn on
 * the page names in `fields`, and only where the document has all of them, so
 * a tab that is not drawn never takes a field out of the page's content.
 */
import type { DeliveredAdminEntry } from "nextly/config";
import { describe, expect, it } from "vitest";

import { fieldsTakenByTabs } from "./place-entries";

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
