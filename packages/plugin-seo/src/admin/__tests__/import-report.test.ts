/**
 * What Import's last step counts and words from the engine's dry run: the
 * four counts in values with the pages each is on, each value's result, the
 * pages the table lists, and the report a person downloads. Each count is
 * read from the engine's per-page report, never worked out again.
 */
import { describe, expect, it } from "vitest";

import type { DryRunBody, ImportReportEntry } from "../../import/contract";
import {
  RESULT_WORDS,
  cellResultOf,
  firstOfPage,
  neverServedWords,
  otherChanges,
  reportCsv,
  reportedPages,
  resultOf,
  showsVersions,
  valueCounts,
  versionWords,
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
    versions: 0,
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
    reason: "The page's code sets its own value now.",
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
      "Page,Version,Outcome,Title on Google,Title result,Description on Google,Description result,Why"
    );
    expect(lines[1]).toBe(
      'Pricing,published,set,Nextly pricing,Will set,"Free, open source",Will set,'
    );
    expect(lines[2]).toBe(
      "About,published,kept,About us,Kept (already typed),Who we are,Same as automatic (left empty),"
    );
    expect(lines[3]).toContain(
      "Old title,Skipped (the page's code sets its own),\"Old, never shown\",Skipped (the page's code sets its own)"
    );
    expect(lines[4]).toBe("/gone,,skipped,,,,,Not on this site.");
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

/** The board's page in two languages, with a draft beside its English one. */
const VERSIONS = runOf([
  entry({
    id: "pricing",
    label: "Pricing",
    locale: "en",
    language: "English",
    version: "published",
    set: ["title", "description"],
    values: { title: "Plans", description: "What it costs" },
  }),
  entry({
    id: "pricing",
    label: "Pricing (new)",
    locale: "en",
    language: "English",
    version: "draft",
    set: ["title"],
    kept: ["description"],
    values: { title: "Plans", description: "What it costs" },
  }),
  entry({
    id: "pricing",
    label: "Preise",
    locale: "de",
    language: "Deutsch",
    version: "published",
    outcome: "skipped",
    withDraft: ["description"],
    same: ["title"],
    values: { title: "Preise", description: "Was es kostet" },
    reason: "Its draft gets these values.",
  }),
  entry({ id: "about", label: "About", version: "published", set: ["title"] }),
]);

describe("a page with several versions", () => {
  it("counts values in every version and each page once", () => {
    expect(valueCounts(VERSIONS)).toMatchObject({
      set: { values: 4, pages: 2 },
      same: { values: 1, pages: 1 },
      kept: { values: 1, pages: 1 },
    });
  });

  it("names each version by its language and form, and says a value goes live with the draft", () => {
    const [published, draft, german] = VERSIONS.documents as [
      ImportReportEntry,
      ImportReportEntry,
      ImportReportEntry,
    ];
    expect(versionWords(published)).toBe("English · published");
    expect(versionWords(draft)).toBe("English · draft");
    expect(versionWords(entry({ version: "draft" }))).toBe("draft");
    expect(resultOf(german, "description")).toBe("withDraft");
    expect(resultOf(german, "title")).toBe("same");
    expect(resultOf(entry({ waiting: ["title"] }), "title")).toBe("waiting");
  });

  it("shows versions only where a page has a language or a draft, and names a page on its first row", () => {
    expect(showsVersions(VERSIONS.documents)).toBe(true);
    expect(showsVersions(RUN.documents)).toBe(false);
    expect(
      VERSIONS.documents.map((_each, at) => firstOfPage(VERSIONS.documents, at))
    ).toEqual([true, false, false, true]);
  });

  it("downloads a row per version, each named", () => {
    const lines = reportCsv(VERSIONS).trimEnd().split("\r\n");
    expect(lines.slice(1).map(line => line.split(",")[1])).toEqual([
      "English · published",
      "English · draft",
      "Deutsch · published",
      "published",
    ]);
  });
});

describe("a version the source holds no value for", () => {
  // A German version with a title in the source and no description: the
  // engine reports nothing for the description, since there is nothing to
  // bring in, and the report says so rather than leaving the cell blank.
  const german = entry({
    label: "Preise",
    locale: "de",
    language: "Deutsch",
    set: ["title"],
    values: { title: "Preise" },
  });

  it("says there is nothing to import for a value the source doesn't hold", () => {
    expect(cellResultOf(german, "title")).toBe("set");
    expect(cellResultOf(german, "description")).toBe("absent");
    // Blank text is no value either.
    expect(
      cellResultOf(entry({ values: { description: "  " } }), "description")
    ).toBe("absent");
    // A value the engine gave no result keeps none: it is not "absent".
    expect(
      cellResultOf(entry({ values: { description: "Held" } }), "description")
    ).toBe("none");
  });

  it("downloads the same words as the table shows", () => {
    const lines = reportCsv(runOf([german]))
      .trimEnd()
      .split("\r\n");
    expect(lines[1]).toBe(
      "Preise,Deutsch · published,set,Preise,Will set,,Nothing to import (not in the source),"
    );
  });
});

describe("the words for values a page's code overrides", () => {
  // The plugin knows only that the page's code sets its own value now, not
  // what the page showed before it was installed.
  const said = [
    ...Object.values(RESULT_WORDS).flatMap(each => [each.label, each.why]),
    ...Object.values(neverServedWords(RUN, false, "SEO (old)") ?? {}),
    ...Object.values(neverServedWords(RUN, true, "SEO (old)") ?? {}),
  ].filter((each): each is string => each !== undefined);

  it("never claim a value was never served", () => {
    expect(said.length).toBeGreaterThan(0);
    for (const words of said) expect(words).not.toMatch(/never served/i);
  });

  it("say the page's code sets its own value, and when to include it", () => {
    expect(neverServedWords(RUN, false, "SEO (old)")).toEqual({
      title: "1 page sets its own values in code, so they'll be skipped",
      text: "Changelog sets its own title and description in its code now, so importing the values stored in SEO (old) would change what the page shows. Include them if the page showed them before and should again.",
    });
    expect(neverServedWords(RUN, true, "SEO (old)")?.title).toBe(
      "Values the page's code overrides are included"
    );
  });
});
