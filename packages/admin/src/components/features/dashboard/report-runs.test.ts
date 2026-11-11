/**
 * The report's lines cut into runs for display: the phrases that read as one
 * fact are kept whole, and the runs join back to the line character for
 * character, so nothing but plain spaces reaches the screen or a copy of it.
 */

import { describe, expect, it } from "vitest";

import { reportRuns } from "./report-runs";

/** The runs drawn whole. */
const whole = (line: string) =>
  reportRuns(line)
    .filter(run => run.whole)
    .map(run => run.text);

const LINES = [
  "Nextly diagnostics, 2026-11-10 17:20 UTC",
  "Nextly: 0.0.2-alpha.74 (latest: 0.0.2-alpha.74)",
  "Runtime: Node 24.11.0 · Next.js 16.4.2 · React 19.2.0",
  "Database: SQLite 3.45.1 · 4 ms round trip",
  "Background jobs: 2 queued · 0 running · 0 failed in 24 h",
  "Content: 7 collections · 4 Singles · 7 users · 3 locales (en, es, ar)",
  "Errors in the last 24 h: 0 (server errors, this server process)",
  "  @nextlyhq/plugin-form-builder 0.0.2-alpha.74",
  "Plugins (4):",
];

describe("reportRuns", () => {
  it("joins back to every line exactly, with no character added or changed", () => {
    for (const line of LINES) {
      expect(
        reportRuns(line)
          .map(run => run.text)
          .join("")
      ).toBe(line);
    }
    expect(reportRuns("")).toEqual([]);
  });

  it("keeps a number with its unit, and a count with the list that names it", () => {
    expect(whole(LINES[4])).toEqual([
      "2 queued",
      "0 running",
      "0 failed",
      "24 h",
    ]);
    expect(whole(LINES[5])).toContain("3 locales (en, es, ar)");
    expect(whole(LINES[3])).toEqual(["SQLite 3.45.1", "4 ms"]);
  });

  it("keeps a name with its version, and a short bracketed note whole", () => {
    expect(whole(LINES[2])).toEqual([
      "Node 24.11.0",
      "Next.js 16.4.2",
      "React 19.2.0",
    ]);
    expect(whole(LINES[1])).toEqual(["(latest: 0.0.2-alpha.74)"]);
  });

  it("lets a long bracketed note wrap at its spaces", () => {
    expect(whole(LINES[6])).toEqual(["24 h"]);
  });
});
