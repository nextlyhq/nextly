/**
 * What Import's last step counts and words from the engine's dry run: the
 * four counts in values with the pages each is on, each value's result, the
 * pages the table lists, and the report a person downloads. Each count is
 * read from the engine's per-page report, never worked out again.
 */
import { describe, expect, it } from "vitest";

import type { DryRunBody, ImportReportEntry } from "../../import/contract";
import {
  otherChanges,
  reportCsv,
  reportedPages,
  resultOf,
  valueCounts,
} from "../import-report";

/** A page's report entry, with what the test gives it. */
function entry(more: Partial<ImportReportEntry>): ImportReportEntry {
  return {
    type: "pages",
    id: more.label ?? "p",
    label: "Page",
    outcome: "set",
    set: [],
    same: [],
    kept: [],
    neverServed: [],
    values: {},
    ...more,
  };
}

/** A dry run holding `documents`. */
function runOf(documents: ImportReportEntry[]): DryRunBody {
  return {
    checked: documents.length,
    fromFile: false,
    held: documents.length,
    lines: [],
    pages: 0,
    same: 0,
    kept: 0,
    neverServed: 0,
    redirects: 0,
    left: [],
    warnings: [],
    documents,
    plan: "digest",
  };
}

const RUN = runOf([
  entry({
    label: "Pricing",
    set: ["title", "description"],
    values: { title: "Nextly pricing", description: "Free, open source" },
  }),
  entry({
    label: "About",
    outcome: "kept",
    kept: ["title"],
    same: ["description"],
    values: { title: "About us", description: "Who we are" },
  }),
  entry({
    label: "Changelog",
    outcome: "skipped",
    neverServed: ["title", "description"],
    values: { title: "Old title", description: "Old, never shown" },
    reason: "Never served: the page's own code sets these values.",
  }),
  // A record that matched no page: reported, but on no page.
  {
    label: "/gone",
    outcome: "skipped",
    set: [],
    same: [],
    kept: [],
    neverServed: [],
    values: {},
    reason: "Not on this site.",
  },
]);

describe("Import's counts", () => {
  it("counts values, with the pages each count is on", () => {
    expect(valueCounts(RUN)).toEqual({
      set: { values: 2, pages: 1 },
      same: { values: 1, pages: 1 },
      kept: { values: 1, pages: 1 },
      neverServed: { values: 2, pages: 1, labels: ["Changelog"] },
    });
  });

  it("words each value's result as the engine decided it", () => {
    const [pricing, about, changelog] = RUN.documents;
    expect(resultOf(pricing as ImportReportEntry, "title")).toBe("set");
    expect(resultOf(about as ImportReportEntry, "title")).toBe("kept");
    expect(resultOf(about as ImportReportEntry, "description")).toBe("same");
    expect(resultOf(changelog as ImportReportEntry, "title")).toBe(
      "neverServed"
    );
    expect(resultOf(pricing as ImportReportEntry, "image")).toBe("none");
  });

  it("lists the pages with a title or description, not records on no page", () => {
    expect(reportedPages(RUN).map(each => each.label)).toEqual([
      "Pricing",
      "About",
      "Changelog",
    ]);
  });

  it("lists a page whose only change is another place, naming that change", () => {
    const hidden = entry({ label: "Old offer", set: ["hidden", "canonical"] });
    const run = runOf([...RUN.documents, hidden]);
    expect(reportedPages(run).map(each => each.label)).toContain("Old offer");
    expect(otherChanges(hidden)).toEqual([
      {
        place: "canonical",
        label: "Official address (canonical)",
        result: "set",
      },
      { place: "hidden", label: "Hide from search", result: "set" },
    ]);
    // A page's title and description are their own columns.
    expect(otherChanges(RUN.documents[0] as ImportReportEntry)).toEqual([]);
  });
});

describe("the downloaded report", () => {
  it("has a row per page and per record passed over, quoting what needs it", () => {
    const lines = reportCsv(RUN).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Page,Outcome,Title on Google,Title result,Description on Google,Description result,Why"
    );
    expect(lines[1]).toBe(
      'Pricing,set,Nextly pricing,Will set,"Free, open source",Will set,'
    );
    expect(lines[2]).toBe(
      "About,kept,About us,Kept (already typed),Who we are,Same as automatic (left empty),"
    );
    expect(lines[3]).toContain(
      'Old title,Skipped (never served),"Old, never shown",Skipped (never served)'
    );
    expect(lines[4]).toBe("/gone,skipped,,,,,Not on this site.");
    expect(lines).toHaveLength(5);
  });
});

describe("a downloaded report holding text a spreadsheet would run", () => {
  it("marks formula-like text as text, and keeps a negative number as it is", () => {
    const run = runOf([
      entry({
        label: '=HYPERLINK("http://x")',
        set: ["title"],
        values: { title: "+1 for us", description: "-12" },
      }),
    ]);
    const row = reportCsv(run).split("\r\n")[1] ?? "";
    expect(row.startsWith(`"'=HYPERLINK(""http://x"")"`)).toBe(true);
    expect(row).toContain(",'+1 for us,");
    expect(row).toContain(",-12,");
  });
});
