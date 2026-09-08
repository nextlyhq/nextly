import { describe, expect, it } from "vitest";

import {
  compareToBaseline,
  declaredNamesIn,
  identityOf,
  pageOf,
} from "./check-doc-samples.mjs";

/**
 * Each guard is asserted against a CONTROL that reproduces what the checker did
 * before it: the same input, scored the old way, passing. A ratchet whose
 * verdict does not move is indistinguishable from a corpus that did not move,
 * so "the count stayed the same" is not evidence that a fix works — showing the
 * old scoring accept what the new scoring rejects is.
 */

/** What the baseline held before fences were part of an identity. */
const messageOnly = line => line.slice(line.indexOf("  ") + 2);

/** A fingerprint keyed the old way, for the control side of each comparison. */
const fingerprintBy = (key, byFile) =>
  Object.fromEntries(
    Object.entries(byFile).map(([file, lines]) => {
      const counts = {};
      for (const line of lines) counts[key(line)] = (counts[key(line)] ?? 0) + 1;
      return [file, counts];
    })
  );

const coverageOf = perPage => ({
  files: Object.keys(perPage),
  samples: Object.values(perPage).reduce((n, p) => n + p.samples, 0),
  compiled: Object.values(perPage).reduce((n, p) => n + p.compiled, 0),
  perPage,
});

describe("identityOf", () => {
  it("keeps the fence and drops the line, so an edit above a fence does not churn the baseline", () => {
    const before = identityOf("docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.");
    const after = identityOf("docs/a.mdx#3:40  error TS2304: Cannot find name 'Post'.");

    expect(before).toBe(after);
    expect(before).toBe("#3 error TS2304: Cannot find name 'Post'.");
  });

  it("tells two fences on one page apart when they carry the same message", () => {
    const third = "docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.";
    const seventh = "docs/a.mdx#7:4  error TS2304: Cannot find name 'Post'.";

    expect(identityOf(third)).not.toBe(identityOf(seventh));
    // The control: scored on the message alone these are one identity, which is
    // what let a page trade a fixed fence for a newly broken one.
    expect(messageOnly(third)).toBe(messageOnly(seventh));
  });

  it("strips an absolute root so a laptop and CI agree", () => {
    const onALaptop = identityOf(
      "docs/a.mdx#1:2  error TS2307: Cannot find module '/Users/me/nextly/x'.",
      "/Users/me/nextly"
    );
    const inCi = identityOf(
      "docs/a.mdx#1:2  error TS2307: Cannot find module '/home/runner/work/nextly/x'.",
      "/home/runner/work/nextly"
    );

    expect(onALaptop).toBe(inCi);
    expect(onALaptop).not.toContain("/Users/me");
  });

  it("gives a diagnostic with no fence no prefix rather than an invented one", () => {
    expect(identityOf("?:0  error TS5055: Would overwrite input file.")).toBe(
      "error TS5055: Would overwrite input file."
    );
  });
});

describe("compareToBaseline", () => {
  const perPage = { "docs/a.mdx": { samples: 4, compiled: 3 } };

  it("catches one fence being fixed while another breaks the same way", () => {
    const held = ["docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'."];
    const now = ["docs/a.mdx#7:4  error TS2304: Cannot find name 'Post'."];
    const baseline = {
      coverage: { pages: 1, samples: 4, compiled: 3 },
      samplesPerPage: perPage,
      pages: { "docs/a.mdx": 1 },
      findings: fingerprintBy(identityOf, { "docs/a.mdx": held }),
    };

    const { appeared, gone, worse, better } = compareToBaseline({
      baseline,
      coverage: coverageOf(perPage),
      counted: { "docs/a.mdx": 1 },
      fingerprint: fingerprintBy(identityOf, { "docs/a.mdx": now }),
    });

    expect(appeared).toEqual(["docs/a.mdx: #7 error TS2304: Cannot find name 'Post'."]);
    expect(gone).toEqual(["docs/a.mdx: #3 error TS2304: Cannot find name 'Post'."]);
    // The control: the count is equal either way, so nothing but the identities
    // is left to notice. Scored on messages alone, this state was accepted.
    expect(worse).toEqual([]);
    expect(better).toEqual([]);
    const control = compareToBaseline({
      baseline: {
        ...baseline,
        findings: fingerprintBy(messageOnly, { "docs/a.mdx": held }),
      },
      coverage: coverageOf(perPage),
      counted: { "docs/a.mdx": 1 },
      fingerprint: fingerprintBy(messageOnly, { "docs/a.mdx": now }),
    });
    expect(control.appeared).toEqual([]);
    expect(control.gone).toEqual([]);
  });

  describe("--only", () => {
    const twoPages = {
      "docs/a.mdx": { samples: 4, compiled: 3 },
      "docs/b.mdx": { samples: 2, compiled: 2 },
    };
    const baseline = {
      coverage: { pages: 2, samples: 6, compiled: 5 },
      samplesPerPage: twoPages,
      pages: { "docs/a.mdx": 1, "docs/b.mdx": 1 },
      findings: {
        "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 },
        "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 1 },
      },
    };

    it("charges the selected page for swapping one diagnostic for another", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf(twoPages),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 1 },
        fingerprint: {
          "docs/a.mdx": { "#3 error TS2551: Property 'sizes' does not exist.": 1 },
          "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 1 },
        },
        only: "docs/a.mdx",
      });

      expect(verdict.appeared).toEqual([
        "docs/a.mdx: #3 error TS2551: Property 'sizes' does not exist.",
      ]);
      // The control: the page's total is 1 before and after, which is the whole
      // of what --only used to compare, so it exited successfully.
      expect(verdict.worse).toEqual([]);
      expect(verdict.better).toEqual([]);
    });

    it("charges the selected page for losing a compiled fence", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf({
          "docs/a.mdx": { samples: 4, compiled: 2 },
          "docs/b.mdx": { samples: 2, compiled: 2 },
        }),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 1 },
        fingerprint: baseline.findings,
        only: "docs/a.mdx",
      });

      expect(verdict.lost).toEqual(["docs/a.mdx: compiled was 3, now 2"]);
      expect(verdict.worse).toEqual([]);
      expect(verdict.better).toEqual([]);
    });

    it("does not charge the selected page for another page's regression", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf(twoPages),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 9 },
        fingerprint: {
          ...baseline.findings,
          "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 9 },
        },
        only: "docs/a.mdx",
      });

      expect(verdict).toEqual({
        lost: [],
        appeared: [],
        gone: [],
        worse: [],
        better: [],
      });
    });

    it("still reports that regression when no page is selected", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf(twoPages),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 9 },
        fingerprint: {
          ...baseline.findings,
          "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 9 },
        },
      });

      expect(verdict.worse).toEqual(["docs/b.mdx: allowed 1, found 9"]);
    });

    it("does not charge the selected page for the repository's totals", () => {
      // Another page left the set entirely. That is a repository-wide loss and
      // the whole-repository run reports it; a person checking their own page
      // should not be handed somebody else's.
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf({ "docs/a.mdx": { samples: 4, compiled: 3 } }),
        counted: { "docs/a.mdx": 1 },
        fingerprint: { "docs/a.mdx": baseline.findings["docs/a.mdx"] },
        only: "docs/a.mdx",
      });

      expect(verdict.lost).toEqual([]);
    });
  });

  describe("--write-baseline", () => {
    // The write path refuses on the SAME `appeared` list the comparison path
    // reports, so what one calls a regression the other cannot record silently.
    it("reports a diagnostic the held baseline does not carry", () => {
      const perPageHere = { "docs/a.mdx": { samples: 4, compiled: 3 } };
      const { appeared } = compareToBaseline({
        baseline: {
          coverage: { pages: 1, samples: 4, compiled: 3 },
          samplesPerPage: perPageHere,
          pages: { "docs/a.mdx": 1 },
          findings: { "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 } },
        },
        coverage: coverageOf(perPageHere),
        counted: { "docs/a.mdx": 2 },
        fingerprint: {
          "docs/a.mdx": {
            "#3 error TS2304: Cannot find name 'Post'.": 1,
            "#4 error TS2304: Cannot find name 'Page'.": 1,
          },
        },
      });

      expect(appeared).toEqual(["docs/a.mdx: #4 error TS2304: Cannot find name 'Page'."]);
    });

    it("reports nothing when the audit matches what the baseline holds", () => {
      const perPageHere = { "docs/a.mdx": { samples: 4, compiled: 3 } };
      const findings = {
        "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 },
      };

      const { appeared } = compareToBaseline({
        baseline: {
          coverage: { pages: 1, samples: 4, compiled: 3 },
          samplesPerPage: perPageHere,
          pages: { "docs/a.mdx": 1 },
          findings,
        },
        coverage: coverageOf(perPageHere),
        counted: { "docs/a.mdx": 1 },
        fingerprint: findings,
      });

      expect(appeared).toEqual([]);
    });
  });
});

describe("pageOf", () => {
  it("takes the page off an attributed diagnostic", () => {
    expect(pageOf("docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.")).toBe(
      "docs/a.mdx"
    );
  });

  it("groups an unattributed diagnostic under `?` rather than under its own message", () => {
    // A diagnostic the compiler could not place carries `?:0` and no `#`, so
    // splitting the raw line on `#` returned the whole line. That made a page
    // key out of an error message, and the gate then reported that message as a
    // page over an allowance of zero.
    const line = "?:0  error TS5055: Would overwrite input file.";

    expect(pageOf(line)).toBe("?");
    // The control: the old grouping kept the entire diagnostic.
    expect(line.split("#")[0]).toBe(line);
  });
});

describe("declaredNamesIn scope tracking", () => {
  // What the character count did, reproduced exactly, as the control.
  const blankNestedByCounting = code => {
    let depth = 0;
    return code
      .split("\n")
      .map(line => {
        const here = depth;
        for (const ch of line) {
          if (ch === "{" || ch === "(" || ch === "[") depth += 1;
          else if (ch === "}" || ch === ")" || ch === "]")
            depth = Math.max(0, depth - 1);
        }
        return here === 0 ? line : "";
      })
      .join("\n");
  };

  it("does not promote a nested name when a string contains a closing brace", () => {
    const code = 'function setup() { const marker = "}"; const hidden = {}; }';

    expect(declaredNamesIn(code).includes("setup")).toBe(true);
    expect(declaredNamesIn(code).includes("hidden")).toBe(false);
    // The control: counting characters closes on the string, so the rest of
    // the line reads as top level and `hidden` looks page-scoped. A later
    // import-free fence using it is then excused as a continuation.
    expect(blankNestedByCounting(code)).toContain("hidden");
  });

  it("does not promote a nested name when a comment contains a closing brace", () => {
    const code = ["function setup() {", "  // closes here: }", "  const hidden = 1;", "}"].join(
      "\n"
    );

    expect(declaredNamesIn(code).includes("hidden")).toBe(false);
    expect(blankNestedByCounting(code)).toContain("hidden");
  });

  it("still reads a genuinely top-level declaration", () => {
    const code = ['const marker = "}";', "const shown = 1;"].join("\n");

    expect(declaredNamesIn(code).includes("marker")).toBe(true);
    expect(declaredNamesIn(code).includes("shown")).toBe(true);
  });
});
